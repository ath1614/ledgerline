import { describe, expect, it } from 'vitest';
import { findBreaches, merchantTotals, trialBalance, trialBalanceTotal } from './ledger';
import { entryBalance, journalEntryFor } from './posting';
import type { PaymentEvent } from './types';
import { MERCHANTS, buildSeed } from './seed';

const seed = buildSeed();
const entries = seed.events.map(journalEntryFor);

describe('trial balance', () => {
  it('nets to exactly zero across the seeded ledger', () => {
    expect(trialBalanceTotal(entries)).toBe(0);
  });

  it('keeps every journal entry balanced', () => {
    for (const entry of entries) {
      expect(entryBalance(entry), entry.id).toBe(0);
    }
  });

  it('reports one row per account', () => {
    expect(trialBalance(entries).map((row) => row.account)).toEqual([
      'processor_clearing',
      'merchant_payable',
      'fee_revenue',
      'bank_settlement',
    ]);
  });

});

describe('integrity sweep', () => {
  it('finds no breaches in the seeded ledger', () => {
    expect(findBreaches(entries)).toEqual([]);
  });

  it('catches an entry that does not balance', () => {
    const broken = structuredClone(entries);
    broken[0].postings[0].amount += 1;
    expect(findBreaches(broken)).toEqual([
      expect.objectContaining({ entryId: broken[0].id, kind: 'unbalanced_entry' }),
    ]);
  });

  it('catches a refund that outruns captured funds', () => {
    const capture: PaymentEvent = {
      id: 'evt_capture',
      type: 'charge.succeeded',
      merchantId: 'mch_kettle',
      currency: 'INR',
      amount: 10_000,
      fee: 200,
      occurredAt: 1,
    };
    const overRefund: PaymentEvent = {
      ...capture,
      id: 'evt_over_refund',
      type: 'refund.succeeded',
      amount: 20_000,
      fee: 0,
      occurredAt: 2,
    };
    const breaches = findBreaches([journalEntryFor(capture), journalEntryFor(overRefund)]);
    expect(breaches).toEqual([
      expect.objectContaining({ entryId: 'trial_balance', kind: 'merchant_payable_negative' }),
    ]);
  });
});

describe('merchant totals', () => {
  it('reconciles captured minus fees minus refunds minus payouts to payable', () => {
    for (const merchant of MERCHANTS) {
      const totals = merchantTotals(entries, merchant.id);
      expect(totals.payable).toBeGreaterThanOrEqual(0);
      expect(totals.captured - totals.fees - totals.refunded - totals.paidOut).toBe(totals.payable);
    }
  });
});
