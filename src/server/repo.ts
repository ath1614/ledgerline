import { journalEntryFor } from '../core/posting';
import { MERCHANTS } from '../core/seed';
import type { Currency, JournalEntry, Merchant, PaymentEvent, SettlementRow } from '../core/types';
import type { D1Database, EntryRow, EventRow, PostingRow } from './env';

export interface Page<T> {
  items: T[];
  nextBefore: number | null;
}

function toEvent(row: EventRow): PaymentEvent {
  const event: PaymentEvent = {
    id: row.id,
    type: row.type as PaymentEvent['type'],
    merchantId: row.merchant_id,
    currency: row.currency as Currency,
    amount: Number(row.amount),
    fee: Number(row.fee),
    occurredAt: Number(row.occurred_at),
  };
  if (row.card) {
    try {
      event.card = JSON.parse(row.card) as NonNullable<PaymentEvent['card']>;
    } catch {
      // A malformed card summary must not take the whole ledger down.
    }
  }
  return event;
}

export class LedgerRepo {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  merchant(id: string): Merchant | undefined {
    return MERCHANTS.find((merchant) => merchant.id === id);
  }

  async allEvents(): Promise<PaymentEvent[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM events ORDER BY occurred_at ASC, id ASC')
      .all<EventRow>();
    return results.map(toEvent);
  }

  async eventsPage(options: { limit: number; before?: number; merchant?: string; type?: string }): Promise<Page<PaymentEvent>> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (options.before) {
      clauses.push('occurred_at < ?');
      values.push(options.before);
    }
    if (options.merchant) {
      clauses.push('merchant_id = ?');
      values.push(options.merchant);
    }
    if (options.type) {
      clauses.push('type = ?');
      values.push(options.type);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { results } = await this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
      .bind(...values, options.limit)
      .all<EventRow>();
    const events = results.map(toEvent);
    return {
      items: events,
      nextBefore: events.length === options.limit ? events[events.length - 1].occurredAt : null,
    };
  }

  async entryForEvent(eventId: string): Promise<JournalEntry | null> {
    const row = await this.db.prepare('SELECT * FROM entries WHERE event_id = ?').bind(eventId).first<EntryRow>();
    if (!row) return null;
    const { results } = await this.db
      .prepare('SELECT * FROM postings WHERE entry_id = ? ORDER BY position ASC')
      .bind(row.id)
      .all<PostingRow>();
    return this.toEntry(row, results, 0);
  }

  async journalPage(options: { limit: number; before?: number }): Promise<Page<JournalEntry>> {
    const clause = options.before ? 'WHERE occurred_at < ?' : '';
    const statement = this.db.prepare(
      `SELECT * FROM entries ${clause} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    );
    const { results: entries } = options.before
      ? await statement.bind(options.before, options.limit).all<EntryRow>()
      : await statement.bind(options.limit).all<EntryRow>();

    if (entries.length === 0) return { items: [], nextBefore: null };

    const ids = entries.map((entry) => entry.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: postings } = await this.db
      .prepare(`SELECT * FROM postings WHERE entry_id IN (${placeholders}) ORDER BY entry_id, position ASC`)
      .bind(...ids)
      .all<PostingRow>();

    const grouped = new Map<string, PostingRow[]>();
    for (const posting of postings) {
      const list = grouped.get(posting.entry_id) ?? [];
      list.push(posting);
      grouped.set(posting.entry_id, list);
    }

    const items = entries.map((entry, index) => this.toEntry(entry, grouped.get(entry.id) ?? [], index));
    return {
      items,
      nextBefore: entries.length === options.limit ? entries[entries.length - 1].occurred_at : null,
    };
  }

  async allEntries(): Promise<JournalEntry[]> {
    const { results: entries } = await this.db
      .prepare('SELECT * FROM entries ORDER BY occurred_at ASC, id ASC')
      .all<EntryRow>();
    const { results: postings } = await this.db
      .prepare('SELECT * FROM postings ORDER BY entry_id, position ASC')
      .all<PostingRow>();
    const grouped = new Map<string, PostingRow[]>();
    for (const posting of postings) {
      const list = grouped.get(posting.entry_id) ?? [];
      list.push(posting);
      grouped.set(posting.entry_id, list);
    }
    return entries.map((entry) => this.toEntry(entry, grouped.get(entry.id) ?? [], 0));
  }

  async settlement(): Promise<SettlementRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM settlement ORDER BY event_id ASC')
      .all<{ event_id: string; merchant_id: string; currency: string; gross: number; fee: number; net: number }>();
    return results.map((row) => ({
      eventId: row.event_id,
      merchantId: row.merchant_id,
      currency: row.currency as Currency,
      gross: Number(row.gross),
      fee: Number(row.fee),
      net: Number(row.net),
    }));
  }

  async meta<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  async findIdempotent(key: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT event_id FROM idempotency WHERE key = ?')
      .bind(key)
      .first<{ event_id: string }>();
    return row?.event_id ?? null;
  }

  async eventById(eventId: string): Promise<PaymentEvent | null> {
    const row = await this.db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<EventRow>();
    return row ? toEvent(row) : null;
  }

  /**
   * Insert an event, its journal entry, its postings and the idempotency record in one
   * D1 batch. D1 batches are atomic, so a retried request can never post twice.
   */
  async postEvent(event: PaymentEvent, idempotencyKey: string): Promise<JournalEntry> {
    const entry = journalEntryFor(event);
    const statements = [
      this.db
        .prepare(
          'INSERT INTO events (id, type, merchant_id, currency, amount, fee, occurred_at, card) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          event.id,
          event.type,
          event.merchantId,
          event.currency,
          event.amount,
          event.fee,
          event.occurredAt,
          event.card ? JSON.stringify(event.card) : null,
        ),
      this.db
        .prepare('INSERT INTO entries (id, event_id, merchant_id, currency, occurred_at, memo) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(entry.id, entry.eventId, entry.merchantId, entry.currency, entry.occurredAt, entry.memo),
      ...entry.postings.map((posting, position) =>
        this.db
          .prepare('INSERT INTO postings (entry_id, account, side, amount, position) VALUES (?, ?, ?, ?, ?)')
          .bind(entry.id, posting.account, posting.side, posting.amount, position),
      ),
      this.db
        .prepare('INSERT INTO idempotency (key, event_id, created_at) VALUES (?, ?, ?)')
        .bind(idempotencyKey, event.id, Date.now()),
    ];
    await this.db.batch(statements);
    return entry;
  }

  private toEntry(row: EntryRow, postings: PostingRow[], _index: number): JournalEntry {
    return {
      id: row.id,
      eventId: row.event_id,
      merchantId: row.merchant_id,
      currency: row.currency as Currency,
      occurredAt: Number(row.occurred_at),
      memo: row.memo,
      postings: postings.map((posting) => ({
        account: posting.account as JournalEntry['postings'][number]['account'],
        side: posting.side as 'debit' | 'credit',
        amount: Number(posting.amount),
      })),
    };
  }
}
