import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { entryBalance, journalEntryFor, postingsFor } from './posting';
import type { PaymentEvent } from './types';

function charge(amount: number, fee: number): PaymentEvent {
  return {
    id: 'evt_test',
    type: 'charge.succeeded',
    merchantId: 'mch_test',
    currency: 'INR',
    amount,
    fee,
    occurredAt: 1_700_000_000_000,
    card: { brand: 'visa', last4: '4242', country: 'IN' },
  };
}

describe('postingsFor', () => {
  it('splits a charge into clearing, payable and fee', () => {
    expect(postingsFor(charge(100_000, 2_300))).toEqual([
      { account: 'processor_clearing', side: 'debit', amount: 100_000 },
      { account: 'fee_revenue', side: 'credit', amount: 2_300 },
      { account: 'merchant_payable', side: 'credit', amount: 97_700 },
    ]);
  });

  it('records a refund as payable moving back to clearing', () => {
    const event: PaymentEvent = { ...charge(50_000, 0), id: 'evt_r', type: 'refund.succeeded' };
    expect(postingsFor(event)).toEqual([
      { account: 'merchant_payable', side: 'debit', amount: 50_000 },
      { account: 'processor_clearing', side: 'credit', amount: 50_000 },
    ]);
  });

  it('records a payout as payable settling into the bank', () => {
    const event: PaymentEvent = { ...charge(75_000, 0), id: 'evt_p', type: 'payout.paid' };
    expect(postingsFor(event)).toEqual([
      { account: 'merchant_payable', side: 'debit', amount: 75_000 },
      { account: 'bank_settlement', side: 'credit', amount: 75_000 },
    ]);
  });

  it('posts nothing for a declined authorisation', () => {
    const event: PaymentEvent = { ...charge(10_000, 0), id: 'evt_f', type: 'charge.failed' };
    expect(postingsFor(event)).toEqual([]);
  });

  it('refuses a fee larger than the charge', () => {
    expect(() => postingsFor(charge(1_000, 1_100))).toThrow(/fee cannot exceed/);
  });

  it('refuses a fee on anything but a successful charge', () => {
    const event: PaymentEvent = { ...charge(10_000, 200), type: 'refund.succeeded' };
    expect(() => postingsFor(event)).toThrow(/only successful charges/);
  });
});

describe('conservation of value', () => {
  it('balances for every charge, at any amount and fee', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), (amount, feeSeed) => {
        const fee = Math.min(feeSeed, amount);
        const entry = journalEntryFor(charge(amount, fee));
        expect(entryBalance(entry)).toBe(0);
        for (const posting of entry.postings) {
          expect(Number.isInteger(posting.amount)).toBe(true);
          expect(posting.amount).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });
});
