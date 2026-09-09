import { describe, expect, it } from 'vitest';
import { reconcile, reconciliationCsv } from './recon';
import { buildSeed } from './seed';
import type { SettlementRow } from './types';

const seed = buildSeed();
const rowsFromLedger = (): SettlementRow[] =>
  seed.events
    .filter((event) => event.type === 'charge.succeeded')
    .map((event) => ({
      eventId: event.id,
      merchantId: event.merchantId,
      currency: event.currency,
      gross: event.amount,
      fee: event.fee,
      net: event.amount - event.fee,
    }));

describe('reconcile', () => {
  it('reports a clean file when every row matches', () => {
    const report = reconcile(seed.events, rowsFromLedger());
    expect(report.clean).toBe(true);
    expect(report.drift).toBe(0);
    expect(report.matched).toBe(report.checked);
  });

  it('surfaces the two defects planted in the seeded settlement file', () => {
    const report = reconcile(seed.events, seed.settlement);
    expect(report.clean).toBe(false);
    expect(report.missingInLedger).toContain('evt_9zzzz');
    expect(report.missingInSettlement).toHaveLength(1);
    expect(report.feeMismatch).toHaveLength(1);
    expect(report.drift).not.toBe(0);
  });

  it('detects a row the processor never sent', () => {
    const rows = rowsFromLedger();
    const removed = rows.splice(0, 1)[0];
    const report = reconcile(seed.events, rows);
    expect(report.missingInSettlement).toEqual([removed.eventId]);
  });

  it('detects a fee that drifts from the contract', () => {
    const rows = rowsFromLedger();
    rows[3] = { ...rows[3], fee: rows[3].fee + 100, net: rows[3].net - 100 };
    const report = reconcile(seed.events, rows);
    expect(report.feeMismatch).toEqual([
      { eventId: rows[3].eventId, ledgerFee: rows[3].fee - 100, settledFee: rows[3].fee },
    ]);
  });
});

describe('dispute export', () => {
  it('writes one CSV line per finding', () => {
    const report = reconcile(seed.events, seed.settlement);
    const csv = reconciliationCsv(report);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('event_id,issue,ledger_minor,settled_minor');
    expect(lines).toHaveLength(
      1 + report.missingInLedger.length + report.missingInSettlement.length + report.feeMismatch.length + report.amountMismatch.length,
    );
  });
});
