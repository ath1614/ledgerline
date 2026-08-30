import { entryBalance, signedAmount } from './posting';
import type { Account, JournalEntry, TrialBalanceRow } from './types';

const ACCOUNTS: Account[] = [
  'processor_clearing',
  'merchant_payable',
  'fee_revenue',
  'bank_settlement',
];

/** Debits minus credits per account, for one currency or all of them. */
export function trialBalance(entries: JournalEntry[], currency?: string): TrialBalanceRow[] {
  const rows = new Map<Account, TrialBalanceRow>(
    ACCOUNTS.map((account) => [account, { account, debit: 0, credit: 0, net: 0 }]),
  );

  for (const entry of entries) {
    if (currency && entry.currency !== currency) continue;
    for (const posting of entry.postings) {
      const row = rows.get(posting.account);
      if (!row) throw new Error(`Unknown account in entry ${entry.id}: ${posting.account}`);
      if (posting.side === 'debit') row.debit += posting.amount;
      else row.credit += posting.amount;
      row.net += signedAmount(posting);
    }
  }

  return ACCOUNTS.map((account) => rows.get(account)!);
}

/** Sum of every account's net. Must be exactly zero: that is what "books balance" means. */
export function trialBalanceTotal(entries: JournalEntry[]): number {
  return trialBalance(entries).reduce((sum, row) => sum + row.net, 0);
}

export interface LedgerBreach {
  entryId: string;
  kind: 'unbalanced_entry' | 'negative_amount' | 'merchant_payable_negative';
  detail: string;
}

/**
 * Full integrity sweep. Every journal entry must balance, and no account may end up
 * with a negative balance: a negative merchant payable means a refund escaped the money
 * that was actually captured.
 */
export function findBreaches(entries: JournalEntry[]): LedgerBreach[] {
  const breaches: LedgerBreach[] = [];

  for (const entry of entries) {
    const balance = entryBalance(entry);
    if (balance !== 0) {
      breaches.push({
        entryId: entry.id,
        kind: 'unbalanced_entry',
        detail: `Entry is off by ${balance} minor units (${entry.currency})`,
      });
    }
    for (const posting of entry.postings) {
      if (!Number.isInteger(posting.amount) || posting.amount < 0) {
        breaches.push({
          entryId: entry.id,
          kind: 'negative_amount',
          detail: `Posting to ${posting.account} is not a non-negative integer`,
        });
      }
    }
  }

  // `merchant_payable` is a liability: credits build it up, debits draw it down. A debit
  // heavier than the credit means the merchant was refunded or paid money never captured.
  const payable = trialBalance(entries).find((row) => row.account === 'merchant_payable');
  if (payable && payable.net > 0) {
    breaches.push({
      entryId: 'trial_balance',
      kind: 'merchant_payable_negative',
      detail: `Merchant payable is overdrawn by ${payable.net} minor units: refunds and payouts exceed captured funds`,
    });
  }

  return breaches;
}

/** Gross captured, fees withheld and net owed, for one merchant. */
export function merchantTotals(entries: JournalEntry[], merchantId: string) {
  let captured = 0;
  let fees = 0;
  let refunded = 0;
  let paidOut = 0;

  for (const entry of entries) {
    if (entry.merchantId !== merchantId) continue;
    for (const posting of entry.postings) {
      if (posting.account === 'processor_clearing' && posting.side === 'debit') captured += posting.amount;
      if (posting.account === 'fee_revenue' && posting.side === 'credit') fees += posting.amount;
      if (posting.account === 'processor_clearing' && posting.side === 'credit') refunded += posting.amount;
      if (posting.account === 'bank_settlement' && posting.side === 'credit') paidOut += posting.amount;
    }
  }

  return { captured, fees, refunded, paidOut, payable: captured - fees - refunded - paidOut };
}

/** Value held per account, as a percentage of gross captured, for the balance sheet view. */
export function accountShare(rows: TrialBalanceRow[], gross: number): Array<TrialBalanceRow & { share: number }> {
  return rows.map((row) => ({ ...row, share: gross === 0 ? 0 : row.net / gross }));
}
