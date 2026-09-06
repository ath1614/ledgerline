import { processorFee } from './money';
import type { Currency, Merchant, PaymentEvent, SettlementRow } from './types';

/**
 * Deterministic synthetic traffic. The dataset ships with four planted incidents so the
 * detector can be demonstrated and tested against known answers, and everything else is
 * generated from a seeded PRNG so two runs are byte-for-byte identical.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

/** 30 October 2026, 00:00 IST. The ledger is "as of" the seed date. */
export const WINDOW_END = Date.UTC(2026, 9, 29, 18, 30);
export const WINDOW_START = WINDOW_END - 30 * DAY;

export const MERCHANTS: Merchant[] = [
  { id: 'mch_kettle', name: 'Kettle & Co', country: 'IN', feeBps: 200, feeFixed: 200 },
  { id: 'mch_nimbus', name: 'Nimbus Threads', country: 'IN', feeBps: 236, feeFixed: 300 },
  { id: 'mch_lantern', name: 'Paper Lantern', country: 'IN', feeBps: 190, feeFixed: 100 },
  { id: 'mch_girish', name: 'Girish Motors', country: 'IN', feeBps: 145, feeFixed: 500 },
  { id: 'mch_saffron', name: 'Saffron Pantry', country: 'IN', feeBps: 220, feeFixed: 150 },
  { id: 'mch_northline', name: 'Northline Studio', country: 'IN', feeBps: 260, feeFixed: 0 },
];

const MERCHANT_BASE_AMOUNT: Record<string, number> = {
  mch_kettle: 89_900,
  mch_nimbus: 189_900,
  mch_lantern: 42_900,
  mch_girish: 549_900,
  mch_saffron: 24_900,
  mch_northline: 129_900,
};

const MERCHANT_WEIGHT: Record<string, number> = {
  mch_kettle: 1.2,
  mch_nimbus: 1.0,
  mch_lantern: 0.8,
  mch_girish: 0.6,
  mch_saffron: 1.4,
  mch_northline: 0.7,
};

const BRANDS: Array<NonNullable<PaymentEvent['card']>['brand']> = [
  'visa',
  'visa',
  'visa',
  'mastercard',
  'mastercard',
  'rupay',
  'amex',
];
const COUNTRIES = ['IN', 'IN', 'IN', 'IN', 'US', 'GB', 'SG'];

/** mulberry32: small, fast, deterministic, and good enough for synthetic fixtures. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Draft {
  type: PaymentEvent['type'];
  merchantId: string;
  currency: Currency;
  amount: number;
  fee: number;
  occurredAt: number;
  card?: PaymentEvent['card'];
  /** Payout targets are resolved chronologically, after all charges and refunds exist. */
  payoutTarget?: number;
  tag?: string;
}

export interface Plant {
  id: string;
  merchantId: string;
  what: string;
  at: number;
}

export interface SeedResult {
  events: PaymentEvent[];
  settlement: SettlementRow[];
  plants: Plant[];
  window: { start: number; end: number };
  merchants: Merchant[];
}

function cardFor(rng: () => number): NonNullable<PaymentEvent['card']> {
  return {
    brand: BRANDS[Math.floor(rng() * BRANDS.length)],
    last4: String(1000 + Math.floor(rng() * 9000)),
    country: COUNTRIES[Math.floor(rng() * COUNTRIES.length)],
  };
}

function amountFor(rng: () => number, merchantId: string): number {
  const base = MERCHANT_BASE_AMOUNT[merchantId];
  const factor = 0.35 + rng() ** 2 * 2.4;
  return Math.max(1_500, Math.round((base * factor) / 100) * 100);
}

export function buildSeed(seed = 20_261_030): SeedResult {
  const rng = mulberry32(seed);
  const drafts: Draft[] = [];
  const plants: Plant[] = [];

  for (let day = 0; day < 30; day += 1) {
    for (const merchant of MERCHANTS) {
      const weight = MERCHANT_WEIGHT[merchant.id];
      const count = Math.max(1, Math.round((0.9 + rng() * 2.2) * weight));
      for (let index = 0; index < count; index += 1) {
        const occurredAt =
          WINDOW_START + day * DAY + 3.5 * HOUR + rng() * 11.5 * HOUR;
        const amount = amountFor(rng, merchant.id);
        const fee = Math.min(amount, processorFee(amount, merchant.feeBps, merchant.feeFixed));
        const card = cardFor(rng);
        const roll = rng();

        if (roll < 0.045) {
          drafts.push({ type: 'charge.failed', merchantId: merchant.id, currency: 'INR', amount, fee: 0, occurredAt, card });
          continue;
        }

        drafts.push({
          type: 'charge.succeeded',
          merchantId: merchant.id,
          currency: 'INR',
          amount,
          fee,
          occurredAt,
          card,
        });

        if (rng() < 0.07) {
          const refundAmount = Math.max(1_000, Math.round((amount * (0.3 + rng() * 0.7)) / 100) * 100);
          drafts.push({
            type: 'refund.succeeded',
            merchantId: merchant.id,
            currency: 'INR',
            amount: refundAmount,
            fee: 0,
            occurredAt: occurredAt + (2 + rng() * 72) * HOUR,
            card,
          });
        }
      }
    }
  }

  // Incident 1: card testing, 9 tiny charges in 6 minutes.
  const cardTestStart = WINDOW_START + 18 * DAY + 4 * HOUR + 30 * MINUTE;
  for (let index = 0; index < 9; index += 1) {
    const amount = 200 + Math.floor(rng() * 4) * 100;
    drafts.push({
      type: 'charge.succeeded',
      merchantId: 'mch_lantern',
      currency: 'INR',
      amount,
      fee: Math.min(amount, processorFee(amount, 190, 100)),
      occurredAt: cardTestStart + index * 40_000,
      card: { brand: 'visa', last4: String(4000 + index), country: 'US' },
      tag: 'card_testing',
    });
  }
  plants.push({
    id: 'card_testing',
    merchantId: 'mch_lantern',
    what: 'Nine sub-50.00 authorisations in six minutes from one card range',
    at: cardTestStart,
  });

  // Incident 2: refund burst on a merchant with healthy volume.
  const refundBurstStart = WINDOW_START + 24 * DAY + 6 * HOUR;
  for (let index = 0; index < 5; index += 1) {
    drafts.push({
      type: 'refund.succeeded',
      merchantId: 'mch_saffron',
      currency: 'INR',
      amount: 15_000,
      fee: 0,
      occurredAt: refundBurstStart + index * 70_000,
      card: { brand: 'mastercard', last4: '8812', country: 'IN' },
      tag: 'refund_burst',
    });
  }
  plants.push({
    id: 'refund_burst',
    merchantId: 'mch_saffron',
    what: 'Five refunds inside six minutes, 100 percent of recent movements',
    at: refundBurstStart,
  });

  // Incident 3: the same amount charged four times in ten minutes.
  const duplicateStart = WINDOW_START + 12 * DAY + 8 * HOUR;
  for (let index = 0; index < 4; index += 1) {
    drafts.push({
      type: 'charge.succeeded',
      merchantId: 'mch_nimbus',
      currency: 'INR',
      amount: 499_900,
      fee: processorFee(499_900, 236, 300),
      occurredAt: duplicateStart + index * 150_000,
      card: { brand: 'rupay', last4: '2214', country: 'IN' },
      tag: 'duplicate_amount',
    });
  }
  plants.push({
    id: 'duplicate_amount',
    merchantId: 'mch_nimbus',
    what: 'Four identical 4,999.00 charges in ten minutes',
    at: duplicateStart,
  });

  // Incident 4: one charge far outside the merchant's normal ticket size.
  const outlierAt = WINDOW_START + 21 * DAY + 5 * HOUR;
  const outlierAmount = 2_450_000;
  drafts.push({
    type: 'charge.succeeded',
    merchantId: 'mch_kettle',
    currency: 'INR',
    amount: outlierAmount,
    fee: processorFee(outlierAmount, 200, 200),
    occurredAt: outlierAt,
    card: { brand: 'amex', last4: '1005', country: 'SG' },
    tag: 'amount_outlier',
  });
  plants.push({
    id: 'amount_outlier',
    merchantId: 'mch_kettle',
    what: 'A 24,500.00 charge against a 900.00 median ticket',
    at: outlierAt,
  });

  // Weekly payouts, resolved in chronological order so payable never goes negative.
  for (const merchant of MERCHANTS) {
    for (const day of [7, 14, 21, 28]) {
      drafts.push({
        type: 'payout.paid',
        merchantId: merchant.id,
        currency: 'INR',
        amount: 0,
        fee: 0,
        occurredAt: WINDOW_START + day * DAY + 2 * HOUR,
        payoutTarget: 0.5,
      });
    }
  }

  const ordered = drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => a.draft.occurredAt - b.draft.occurredAt || a.index - b.index)
    .map(({ draft }) => draft);

  const payable = new Map<string, number>(MERCHANTS.map((merchant) => [merchant.id, 0]));
  const events: PaymentEvent[] = [];
  let counter = 0;

  for (const draft of ordered) {
    // Refunds can be scheduled a few days after their charge. Drop the ones that would
    // land beyond the statement window rather than pretending the ledger sees the future.
    if (draft.occurredAt > WINDOW_END) continue;

    const balance = payable.get(draft.merchantId) ?? 0;
    if (draft.type === 'payout.paid') {
      const amount = Math.min(balance, Math.round(balance * (draft.payoutTarget ?? 0.5)));
      if (amount < 10_000) continue;
      draft.amount = amount;
    }
    if (draft.type === 'refund.succeeded') {
      draft.amount = Math.min(draft.amount, balance);
      if (draft.amount <= 0) continue;
    }

    if (draft.type === 'charge.succeeded') payable.set(draft.merchantId, balance + draft.amount - draft.fee);
    else if (draft.type === 'refund.succeeded') payable.set(draft.merchantId, balance - draft.amount);
    else if (draft.type === 'payout.paid') payable.set(draft.merchantId, balance - draft.amount);

    events.push({
      id: `evt_${(counter++).toString(36).padStart(5, '0')}`,
      type: draft.type,
      merchantId: draft.merchantId,
      currency: draft.currency,
      amount: draft.amount,
      fee: draft.fee,
      occurredAt: Math.round(draft.occurredAt),
      ...(draft.card ? { card: draft.card } : {}),
    });
  }

  const settlement = settlementFor(events, rng);

  return {
    events,
    settlement,
    plants,
    window: { start: WINDOW_START, end: WINDOW_END },
    merchants: MERCHANTS,
  };
}

/**
 * Settlement file for the processor: one row per captured charge, with two deliberate
 * defects, one missing row and one fee that differs from the ledger.
 */
function settlementFor(events: PaymentEvent[], rng: () => number): SettlementRow[] {
  const charges = events.filter((event) => event.type === 'charge.succeeded');
  if (charges.length === 0) return [];

  const dropped = charges[Math.floor(charges.length * 0.31)];
  const feeError = charges[Math.floor(charges.length * 0.62)];
  const rows: SettlementRow[] = charges
    .filter((event) => event.id !== dropped.id)
    .map((event) => {
      const fee = event.id === feeError.id ? event.fee + 2_500 : event.fee;
      return {
        eventId: event.id,
        merchantId: event.merchantId,
        currency: event.currency,
        gross: event.amount,
        fee,
        net: event.amount - fee,
      };
    });

  const ghostAmount = 76_500 + Math.floor(rng() * 40) * 100;
  rows.push({
    eventId: 'evt_9zzzz',
    merchantId: 'mch_kettle',
    currency: 'INR',
    gross: ghostAmount,
    fee: processorFee(ghostAmount, 200, 200),
    net: ghostAmount - processorFee(ghostAmount, 200, 200),
  });

  return rows.sort((a, b) => a.eventId.localeCompare(b.eventId));
}
