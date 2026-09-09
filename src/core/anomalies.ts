import type { AnomalyCode, AnomalyFinding, PaymentEvent, Severity } from './types';

/**
 * Explainable, rule-based risk scoring. Each rule answers one question a payments
 * operations team would actually ask, and reports the evidence it used. No opaque model:
 * every score can be defended line by line in a review.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface Rule {
  code: AnomalyCode;
  score: number;
  /** One incident should produce one finding, not one per event inside the burst. */
  cooldownMs: number;
  /** Charge rules must never be run against a payout: the amounts are not comparable. */
  appliesTo: PaymentEvent['type'][];
  test: (ctx: RuleContext) => string[] | null;
}

interface RuleContext {
  event: PaymentEvent;
  history: PaymentEvent[];
  windowStart: number;
}

function chargesIn(history: PaymentEvent[], merchantId: string, from: number, to: number): PaymentEvent[] {
  return history.filter(
    (candidate) =>
      candidate.merchantId === merchantId &&
      candidate.type === 'charge.succeeded' &&
      candidate.occurredAt >= from &&
      candidate.occurredAt <= to,
  );
}

function refundsIn(history: PaymentEvent[], merchantId: string, from: number, to: number): PaymentEvent[] {
  return history.filter(
    (candidate) =>
      candidate.merchantId === merchantId &&
      candidate.type === 'refund.succeeded' &&
      candidate.occurredAt >= from &&
      candidate.occurredAt <= to,
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function robustSigma(values: number[]): number {
  if (values.length < 5) return 0;
  const centre = median(values);
  const deviations = values.map((value) => Math.abs(value - centre));
  return median(deviations) * 1.4826;
}

const RULES: Rule[] = [
  {
    code: 'card_testing',
    score: 92,
    cooldownMs: 30 * MINUTE,
    appliesTo: ['charge.succeeded'],
    test: ({ event, history }) => {
      // Card testing shows up as a burst of tiny authorisations while the attacker
      // checks which stolen numbers are live.
      const burst = chargesIn(history, event.merchantId, event.occurredAt - 10 * MINUTE, event.occurredAt).filter(
        (candidate) => candidate.amount <= 5_000,
      );
      if (burst.length < 5) return null;
      return [
        `${burst.length} charges under 50.00 in 10 minutes`,
        `smallest ${(Math.min(...burst.map((c) => c.amount)) / 100).toFixed(2)}, largest ${(Math.max(...burst.map((c) => c.amount)) / 100).toFixed(2)}`,
      ];
    },
  },
  {
    code: 'velocity_spike',
    score: 71,
    cooldownMs: 30 * MINUTE,
    appliesTo: ['charge.succeeded'],
    test: ({ event, history, windowStart }) => {
      const from = event.occurredAt - 10 * MINUTE;
      const burst = chargesIn(history, event.merchantId, from, event.occurredAt);
      const elapsedMinutes = Math.max(1, (event.occurredAt - windowStart) / MINUTE);
      const baselineBeforeWindow = chargesIn(history, event.merchantId, windowStart, from - 1).length;
      const expectedPerTenMinutes = (baselineBeforeWindow / elapsedMinutes) * 10;
      if (burst.length < 8) return null;
      if (burst.length < expectedPerTenMinutes * 4) return null;
      return [
        `${burst.length} charges in 10 minutes`,
        `baseline ${expectedPerTenMinutes.toFixed(1)} per 10 minutes over ${Math.round(elapsedMinutes)} minutes`,
      ];
    },
  },
  {
    code: 'amount_outlier',
    score: 64,
    cooldownMs: 6 * HOUR,
    appliesTo: ['charge.succeeded'],
    test: ({ event, history }) => {
      if (event.amount < 10_000) return null;
      const prior = chargesIn(history, event.merchantId, 0, event.occurredAt - 1).map((candidate) => candidate.amount);
      if (prior.length < 12) return null;
      const centre = median(prior);
      const sigma = robustSigma(prior);
      if (sigma === 0) return null;
      const z = (event.amount - centre) / sigma;
      if (z < 4 || event.amount < centre * 5) return null;
      return [
        `amount is ${z.toFixed(1)} robust deviations above the merchant median`,
        `median ${(centre / 100).toFixed(2)}, this charge ${(event.amount / 100).toFixed(2)}`,
      ];
    },
  },
  {
    code: 'refund_burst',
    score: 86,
    cooldownMs: 30 * MINUTE,
    appliesTo: ['refund.succeeded'],
    test: ({ event, history }) => {
      const from = event.occurredAt - 5 * MINUTE;
      const refunds = refundsIn(history, event.merchantId, from, event.occurredAt);
      const charges = chargesIn(history, event.merchantId, from, event.occurredAt);
      if (refunds.length < 3) return null;
      const ratio = charges.length === 0 ? 1 : refunds.length / (refunds.length + charges.length);
      if (ratio < 0.4) return null;
      return [
        `${refunds.length} refunds in 5 minutes`,
        `${(ratio * 100).toFixed(0)}% of recent movements were refunds`,
      ];
    },
  },
  {
    code: 'duplicate_amount',
    score: 47,
    cooldownMs: 60 * MINUTE,
    appliesTo: ['charge.succeeded'],
    test: ({ event, history }) => {
      const from = event.occurredAt - 15 * MINUTE;
      const same = chargesIn(history, event.merchantId, from, event.occurredAt).filter(
        (candidate) => candidate.amount === event.amount && candidate.id !== event.id,
      );
      if (same.length < 2) return null;
      return [
        `${same.length + 1} charges of exactly ${(event.amount / 100).toFixed(2)} in 15 minutes`,
        `likely a retried checkout or a stuck client`,
      ];
    },
  },
];

export function severityOf(score: number): Severity {
  if (score >= 85) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

/**
 * Score every event against every rule, using only events that happened before it.
 * Results are deterministic for a given event stream.
 */
export function detectAnomalies(events: PaymentEvent[], windowStart?: number): AnomalyFinding[] {
  const ordered = [...events].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  const start = windowStart ?? (ordered.length > 0 ? ordered[0].occurredAt : 0);
  const findings: AnomalyFinding[] = [];
  const lastSeen = new Map<string, number>();

  ordered.forEach((event, index) => {
    if (event.type === 'charge.failed') return;
    const history = ordered.slice(0, index + 1);
    for (const rule of RULES) {
      if (!rule.appliesTo.includes(event.type)) continue;
      const key = `${event.merchantId}:${rule.code}`;
      const previous = lastSeen.get(key);
      if (previous !== undefined && event.occurredAt - previous < rule.cooldownMs) continue;

      const reasons = rule.test({ event, history, windowStart: start });
      if (!reasons) continue;
      lastSeen.set(key, event.occurredAt);
      findings.push({
        eventId: event.id,
        merchantId: event.merchantId,
        code: rule.code,
        score: rule.score,
        severity: severityOf(rule.score),
        reasons,
        occurredAt: event.occurredAt,
      });
    }
  });

  return findings.sort((a, b) => b.score - a.score || b.occurredAt - a.occurredAt);
}

export function riskScoreFor(eventId: string, findings: AnomalyFinding[]): number {
  return findings
    .filter((finding) => finding.eventId === eventId)
    .reduce((highest, finding) => Math.max(highest, finding.score), 0);
}

export function summariseFindings(findings: AnomalyFinding[]) {
  return {
    total: findings.length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
    flaggedEvents: new Set(findings.map((finding) => finding.eventId)).size,
  };
}
