import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';

const seed = buildSeed();

describe('deterministic fixtures', () => {
  it('produces identical events for the same seed', () => {
    expect(JSON.stringify(buildSeed().events)).toBe(JSON.stringify(seed.events));
  });

  it('produces a different ledger for a different seed', () => {
    expect(JSON.stringify(buildSeed(7).events)).not.toBe(JSON.stringify(seed.events));
  });

  it('orders events chronologically and ids uniquely', () => {
    const times = seed.events.map((event) => event.occurredAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(seed.events.map((event) => event.id)).size).toBe(seed.events.length);
  });

  it('covers every event type in the demo data', () => {
    const types = new Set(seed.events.map((event) => event.type));
    expect(types).toEqual(new Set(['charge.succeeded', 'charge.failed', 'refund.succeeded', 'payout.paid']));
  });

  it('never pays out more than the merchant is owed', () => {
    const payable = new Map<string, number>();
    for (const event of seed.events) {
      const current = payable.get(event.merchantId) ?? 0;
      if (event.type === 'charge.succeeded') payable.set(event.merchantId, current + event.amount - event.fee);
      if (event.type === 'refund.succeeded') payable.set(event.merchantId, current - event.amount);
      if (event.type === 'payout.paid') payable.set(event.merchantId, current - event.amount);
      expect(payable.get(event.merchantId) ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the dataset small enough to seed inside a Worker request', () => {
    expect(seed.events.length).toBeGreaterThan(250);
    expect(seed.events.length).toBeLessThan(600);
  });
});
