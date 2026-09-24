import { journalEntryFor } from '../core/posting';
import { buildSeed } from '../core/seed';
import type { D1Database } from './env';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount INTEGER NOT NULL,
    fee INTEGER NOT NULL,
    occurred_at INTEGER NOT NULL,
    card TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS events_by_time ON events (occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS events_by_merchant ON events (merchant_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    memo TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS entries_by_event ON entries (event_id)`,
  `CREATE TABLE IF NOT EXISTS postings (
    entry_id TEXT NOT NULL,
    account TEXT NOT NULL,
    side TEXT NOT NULL,
    amount INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (entry_id, position)
  )`,
  `CREATE INDEX IF NOT EXISTS postings_by_entry ON postings (entry_id)`,
  `CREATE TABLE IF NOT EXISTS settlement (
    event_id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    gross INTEGER NOT NULL,
    fee INTEGER NOT NULL,
    net INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency (
    key TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export const SEED_LOCK = 'ledgerline.seeded';

/** Idempotent schema creation, safe to call before every request batch. */
export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/**
 * Seed once, guarded by a meta row. The dataset is deterministic, so a reviewer can
 * regenerate exactly this ledger by calling buildSeed with the same seed.
 */
export async function ensureSeed(db: D1Database): Promise<void> {
  const marker = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(SEED_LOCK).first<{ value: string }>();
  if (marker) return;

  const seed = buildSeed();
  const statements = [];

  for (const event of seed.events) {
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO events (id, type, merchant_id, currency, amount, fee, occurred_at, card) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
    );
  }

  for (const event of seed.events) {
    const entry = journalEntryFor(event);
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO entries (id, event_id, merchant_id, currency, occurred_at, memo) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(entry.id, entry.eventId, entry.merchantId, entry.currency, entry.occurredAt, entry.memo),
    );
    entry.postings.forEach((posting, position) => {
      statements.push(
        db
          .prepare('INSERT OR IGNORE INTO postings (entry_id, account, side, amount, position) VALUES (?, ?, ?, ?, ?)')
          .bind(entry.id, posting.account, posting.side, posting.amount, position),
      );
    });
  }

  for (const row of seed.settlement) {
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO settlement (event_id, merchant_id, currency, gross, fee, net) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.eventId, row.merchantId, row.currency, row.gross, row.fee, row.net),
    );
  }

  const meta: Array<[string, string]> = [
    [SEED_LOCK, String(Date.now())],
    ['window', JSON.stringify(seed.window)],
    ['plants', JSON.stringify(seed.plants)],
    ['merchants', JSON.stringify(seed.merchants)],
  ];
  for (const [key, value] of meta) {
    statements.push(db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(key, value));
  }

  for (const batch of chunk(statements, 60)) {
    await db.batch(batch);
  }
}

export async function resetDemo(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM postings'),
    db.prepare('DELETE FROM entries'),
    db.prepare('DELETE FROM events'),
    db.prepare('DELETE FROM settlement'),
    db.prepare('DELETE FROM idempotency'),
    db.prepare('DELETE FROM meta'),
  ]);
  await ensureSchema(db);
  await ensureSeed(db);
}

