import { describe, expect, it } from 'vitest';
import { detectAnomalies, severityOf, summariseFindings } from './anomalies';
import { buildSeed } from './seed';
import type { PaymentEvent } from './types';

const seed = buildSeed();
const findings = detectAnomalies(seed.events, seed.window.start);

function has(code: string, merchantId: string): boolean {
  return findings.some((finding) => finding.code === code && finding.merchantId === merchantId);
}

describe('planted incidents', () => {
  it('finds card testing on the merchant that was attacked', () => {
    expect(has('card_testing', 'mch_lantern')).toBe(true);
  });

  it('finds the refund burst', () => {
    expect(has('refund_burst', 'mch_saffron')).toBe(true);
  });

  it('finds repeated identical amounts', () => {
    expect(has('duplicate_amount', 'mch_nimbus')).toBe(true);
  });

  it('finds the ticket-size outlier', () => {
    expect(has('amount_outlier', 'mch_kettle')).toBe(true);
  });

  it('attaches readable evidence to every finding', () => {
    for (const finding of findings) {
      expect(finding.reasons.length).toBeGreaterThan(0);
      expect(finding.score).toBeGreaterThan(0);
      expect(finding.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('false positives', () => {
  it('stays silent on an even stream of ordinary charges', () => {
    const clean: PaymentEvent[] = Array.from({ length: 40 }, (_, index) => ({
      id: `evt_clean_${index}`,
      type: 'charge.succeeded' as const,
      merchantId: 'mch_clean',
      currency: 'INR' as const,
      amount: 12_000 + index * 1_337,
      fee: 240,
      occurredAt: seed.window.start + index * 20 * 60_000,
      card: { brand: 'visa' as const, last4: '4242', country: 'IN' },
    }));
    expect(detectAnomalies(clean, seed.window.start)).toEqual([]);
  });
});

describe('severity', () => {
  it('bands scores consistently', () => {
    expect(severityOf(92)).toBe('high');
    expect(severityOf(71)).toBe('medium');
    expect(severityOf(20)).toBe('low');
  });

  it('summarises by band and unique event', () => {
    const summary = summariseFindings(findings);
    expect(summary.total).toBe(findings.length);
    expect(summary.high + summary.medium + summary.low).toBe(summary.total);
    expect(summary.flaggedEvents).toBeLessThanOrEqual(summary.total);
  });
});
