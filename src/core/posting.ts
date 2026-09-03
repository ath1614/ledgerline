import type { JournalEntry, PaymentEvent, Posting } from './types';

/**
 * Posting rules. Every entry must balance to zero within its own currency.
 *
 *   charge.succeeded   DR processor_clearing (gross)
 *                      CR merchant_payable   (gross - fee)
 *                      CR fee_revenue        (fee)
 *
 *   refund.succeeded   DR merchant_payable   (amount)
 *                      CR processor_clearing (amount)
 *
 *   payout.paid        DR merchant_payable   (amount)
 *                      CR bank_settlement    (amount)
 *
 *   charge.failed      no postings: nothing moved, but the attempt is still evidence.
 */
export function postingsFor(event: PaymentEvent): Posting[] {
  assertEventInvariants(event);

  switch (event.type) {
    case 'charge.succeeded': {
      const net = event.amount - event.fee;
      const postings: Posting[] = [
        { account: 'processor_clearing', side: 'debit', amount: event.amount },
        { account: 'fee_revenue', side: 'credit', amount: event.fee },
      ];
      if (net > 0) postings.push({ account: 'merchant_payable', side: 'credit', amount: net });
      return postings;
    }
    case 'refund.succeeded':
      return [
        { account: 'merchant_payable', side: 'debit', amount: event.amount },
        { account: 'processor_clearing', side: 'credit', amount: event.amount },
      ];
    case 'payout.paid':
      return [
        { account: 'merchant_payable', side: 'debit', amount: event.amount },
        { account: 'bank_settlement', side: 'credit', amount: event.amount },
      ];
    case 'charge.failed':
      return [];
    default: {
      const exhaustive: never = event.type;
      throw new Error(`Unsupported event type: ${String(exhaustive)}`);
    }
  }
}

export function journalEntryFor(event: PaymentEvent): JournalEntry {
  return {
    id: `jrn_${event.id.replace(/^evt_/, '')}`,
    eventId: event.id,
    merchantId: event.merchantId,
    currency: event.currency,
    occurredAt: event.occurredAt,
    memo: memoFor(event),
    postings: postingsFor(event),
  };
}

function memoFor(event: PaymentEvent): string {
  const rupees = (event.amount / 100).toFixed(2);
  switch (event.type) {
    case 'charge.succeeded':
      return `Capture ${event.currency} ${rupees} on ${event.card?.brand ?? 'card'} ${event.card?.last4 ?? '----'}`;
    case 'charge.failed':
      return `Declined authorisation for ${event.currency} ${rupees}`;
    case 'refund.succeeded':
      return `Refund ${event.currency} ${rupees} to ${event.card?.last4 ?? 'customer'}`;
    case 'payout.paid':
      return `Payout ${event.currency} ${rupees} to settlement account`;
  }
}

export function assertEventInvariants(event: PaymentEvent): void {
  if (!Number.isInteger(event.amount) || event.amount < 0) {
    throw new RangeError(`Event ${event.id}: amount must be a non-negative integer`);
  }
  if (!Number.isInteger(event.fee) || event.fee < 0) {
    throw new RangeError(`Event ${event.id}: fee must be a non-negative integer`);
  }
  if (event.fee > event.amount) {
    throw new RangeError(`Event ${event.id}: fee cannot exceed the captured amount`);
  }
  if (event.type !== 'charge.succeeded' && event.fee !== 0) {
    throw new RangeError(`Event ${event.id}: only successful charges carry a fee`);
  }
  if (!Number.isFinite(event.occurredAt)) {
    throw new TypeError(`Event ${event.id}: occurredAt must be a timestamp`);
  }
}

/** Signed value of a posting from the ledger's point of view (debit positive). */
export function signedAmount(posting: Posting): number {
  return posting.side === 'debit' ? posting.amount : -posting.amount;
}

export function entryBalance(entry: JournalEntry): number {
  return entry.postings.reduce((sum, posting) => sum + signedAmount(posting), 0);
}
