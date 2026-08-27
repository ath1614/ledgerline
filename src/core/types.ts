/**
 * Domain types shared by the Worker API, the browser app and the test suite.
 * All money values are integer minor units (paise, cents). No floats touch an amount.
 */

export const CURRENCIES = ['INR', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const EVENT_TYPES = [
  'charge.succeeded',
  'charge.failed',
  'refund.succeeded',
  'payout.paid',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type Account =
  | 'processor_clearing'
  | 'merchant_payable'
  | 'fee_revenue'
  | 'bank_settlement';

export type Side = 'debit' | 'credit';

export interface CardSummary {
  brand: 'visa' | 'mastercard' | 'rupay' | 'amex';
  last4: string;
  country: string;
}

export interface PaymentEvent {
  /** Stable id, `evt_` prefixed. Used as the reconciliation join key. */
  id: string;
  type: EventType;
  merchantId: string;
  currency: Currency;
  /** Gross amount captured or refunded, in minor units. */
  amount: number;
  /** Processor fee withheld on a charge, in minor units. Zero for other types. */
  fee: number;
  /** Epoch milliseconds. */
  occurredAt: number;
  card?: CardSummary;
}

export interface Posting {
  account: Account;
  side: Side;
  amount: number;
}

export interface JournalEntry {
  id: string;
  eventId: string;
  merchantId: string;
  currency: Currency;
  occurredAt: number;
  memo: string;
  postings: Posting[];
}

export interface Merchant {
  id: string;
  name: string;
  country: string;
  /** Fee plan: basis points of the gross amount plus a fixed minor-unit fee. */
  feeBps: number;
  feeFixed: number;
}

export interface SettlementRow {
  eventId: string;
  merchantId: string;
  currency: Currency;
  gross: number;
  fee: number;
  net: number;
}

export type AnomalyCode =
  | 'card_testing'
  | 'velocity_spike'
  | 'amount_outlier'
  | 'refund_burst'
  | 'duplicate_amount';

export type Severity = 'low' | 'medium' | 'high';

export interface AnomalyFinding {
  eventId: string;
  merchantId: string;
  code: AnomalyCode;
  /** 0 to 100. Rules are additive evidence, capped, so the number is explainable. */
  score: number;
  severity: Severity;
  reasons: string[];
  occurredAt: number;
}

export interface TrialBalanceRow {
  account: Account;
  debit: number;
  credit: number;
  /** debit minus credit. Positive means the account holds value. */
  net: number;
}

export interface ReconBreakdown {
  matched: number;
  missingInLedger: string[];
  missingInSettlement: string[];
  feeMismatch: Array<{ eventId: string; ledgerFee: number; settledFee: number }>;
  amountMismatch: Array<{ eventId: string; ledgerAmount: number; settledAmount: number }>;
}

export interface ReconReport extends ReconBreakdown {
  checked: number;
  currency: Currency;
  ledgerNet: number;
  settledNet: number;
  drift: number;
  clean: boolean;
}
