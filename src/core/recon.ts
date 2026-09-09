import type { Currency, PaymentEvent, ReconReport, SettlementRow } from './types';

/**
 * Reconcile a processor settlement file against the ledger. Missing rows and fee
 * differences are the two ways money quietly goes missing, so both are first class here.
 */
export function reconcile(
  events: PaymentEvent[],
  settlementRows: SettlementRow[],
  currency: Currency = 'INR',
): ReconReport {
  const captured = new Map(
    events
      .filter((event) => event.type === 'charge.succeeded' && event.currency === currency)
      .map((event) => [event.id, event]),
  );
  const settled = new Map(
    settlementRows
      .filter((row) => row.currency === currency)
      .map((row) => [row.eventId, row]),
  );

  const missingInLedger: string[] = [];
  const missingInSettlement: string[] = [];
  const feeMismatch: ReconReport['feeMismatch'] = [];
  const amountMismatch: ReconReport['amountMismatch'] = [];
  let matched = 0;

  for (const [eventId, row] of settled) {
    const event = captured.get(eventId);
    if (!event) {
      missingInLedger.push(eventId);
      continue;
    }
    if (event.amount !== row.gross) {
      amountMismatch.push({ eventId, ledgerAmount: event.amount, settledAmount: row.gross });
      continue;
    }
    if (event.fee !== row.fee) {
      feeMismatch.push({ eventId, ledgerFee: event.fee, settledFee: row.fee });
      continue;
    }
    matched += 1;
  }

  for (const eventId of captured.keys()) {
    if (!settled.has(eventId)) missingInSettlement.push(eventId);
  }

  const ledgerNet = [...captured.values()].reduce((sum, event) => sum + event.amount - event.fee, 0);
  const settledNet = settlementRows
    .filter((row) => row.currency === currency)
    .reduce((sum, row) => sum + row.net, 0);

  return {
    checked: captured.size,
    currency,
    matched,
    missingInLedger: missingInLedger.sort(),
    missingInSettlement: missingInSettlement.sort(),
    feeMismatch: feeMismatch.sort((a, b) => a.eventId.localeCompare(b.eventId)),
    amountMismatch: amountMismatch.sort((a, b) => a.eventId.localeCompare(b.eventId)),
    ledgerNet,
    settledNet,
    drift: settledNet - ledgerNet,
    clean:
      missingInLedger.length === 0 &&
      missingInSettlement.length === 0 &&
      feeMismatch.length === 0 &&
      amountMismatch.length === 0 &&
      settledNet === ledgerNet,
  };
}

/** CSV a finance team could hand back to the processor when opening a dispute. */
export function reconciliationCsv(report: ReconReport): string {
  const header = 'event_id,issue,ledger_minor,settled_minor';
  const rows: string[] = [header];
  for (const eventId of report.missingInLedger) rows.push(`${eventId},missing_in_ledger,,`);
  for (const eventId of report.missingInSettlement) rows.push(`${eventId},missing_in_settlement,,`);
  for (const item of report.feeMismatch) rows.push(`${item.eventId},fee_mismatch,${item.ledgerFee},${item.settledFee}`);
  for (const item of report.amountMismatch) {
    rows.push(`${item.eventId},amount_mismatch,${item.ledgerAmount},${item.settledAmount}`);
  }
  return `${rows.join('\n')}\n`;
}
