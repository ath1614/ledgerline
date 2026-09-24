import type {
  AnomalyFinding,
  Currency,
  JournalEntry,
  Merchant,
  PaymentEvent,
  ReconReport,
  TrialBalanceRow,
} from './types';

export interface EventView extends PaymentEvent {
  risk: number;
  findingCodes: string[];
  merchantName: string;
}

export interface JournalView extends JournalEntry {
  merchantName: string;
  risk: number;
}

export interface AnomalyView extends AnomalyFinding {
  merchantName: string;
  event: PaymentEvent | null;
}

export interface SummaryResponse {
  window: { start: number; end: number };
  counts: {
    events: number;
    charges: number;
    refunds: number;
    payouts: number;
    failed: number;
    flaggedEvents: number;
  };
  volume: {
    captured: number;
    fees: number;
    refunded: number;
    paidOut: number;
    payable: number;
  };
  trialBalance: TrialBalanceRow[];
  findings: { total: number; high: number; medium: number; low: number; flaggedEvents: number };
  recon: {
    clean: boolean;
    checked: number;
    matched: number;
    drift: number;
    missingInLedger: number;
    missingInSettlement: number;
    feeMismatch: number;
    amountMismatch: number;
  };
  merchants: Merchant[];
  plants: Array<{ id: string; merchantId: string; what: string; at: number }>;
  seededAt: number;
}

export interface EventsResponse {
  events: EventView[];
  nextBefore: number | null;
}

export interface JournalResponse {
  entries: JournalView[];
  nextBefore: number | null;
}

export interface AnomaliesResponse {
  anomalies: AnomalyView[];
}

export interface ReconResponse extends ReconReport {
  rows: Array<{
    eventId: string;
    issue: 'missing_in_ledger' | 'missing_in_settlement' | 'fee_mismatch' | 'amount_mismatch';
    ledger: number | null;
    settled: number | null;
    merchantName: string;
    occurredAt: number | null;
  }>;
  csv: string;
  currency: Currency;
}

export interface ApiError {
  error: string;
}
