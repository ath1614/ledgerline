/**
 * The idempotency claim, tested where it can actually fail: several retries arriving at once,
 * and a write that dies half-way. Everything here goes through the real Hono routes, so the
 * handler, the repo, the schema and the SQL are the ones that ship.
 */
import { describe, expect, it, vi } from 'vitest';
import app from './index';
import { SqliteD1 } from './testing/sqlite';

interface TestEnv {
  DB: SqliteD1;
  ASSETS: { fetch: () => Promise<Response> };
}

const CHARGE = { merchantId: 'mch_lantern', type: 'charge.succeeded', amount: 250_000 };

async function freshLedger(): Promise<TestEnv> {
  const DB = new SqliteD1();
  const env: TestEnv = { DB, ASSETS: { fetch: async () => new Response('not used') } };
  const health = await app.request('/api/health', {}, env);
  expect(health.status).toBe(200);
  return env;
}

function ingest(env: TestEnv, key: string, body: unknown = CHARGE) {
  return app.request(
    '/api/events',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    },
    env as never,
  );
}

async function count(env: TestEnv, table: string, where = ''): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function balance(env: TestEnv) {
  const response = await app.request('/api/health', {}, env);
  return (await response.json()) as {
    ok: boolean;
    events: number;
    entries: number;
    balanced: boolean;
    breaches: unknown[];
  };
}

describe('concurrent retries of one idempotency key', () => {
  it('posts one charge no matter how many arrive at once', async () => {
    const env = await freshLedger();
    const before = await count(env, 'events');

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => ingest(env, 'retry-storm-0001')),
    );
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as {
      event?: { id: string; amount: number };
      replayed?: boolean;
    }[];

    expect(responses.every((response) => response.status === 201 || response.status === 200)).toBe(true);
    const ids = new Set(bodies.map((body) => body.event?.id));
    expect(ids.size).toBe(1);
    expect(await count(env, 'events')).toBe(before + 1);

    const winner = [...ids][0] as string;
    expect(await count(env, 'entries', `WHERE event_id = '${winner}'`)).toBe(1);
    expect(await count(env, 'idempotency', `WHERE event_id = '${winner}'`)).toBe(1);

    const ledger = await balance(env);
    expect(ledger.balanced).toBe(true);
    expect(ledger.breaches).toEqual([]);
  });

  it('answers every loser with the first write, not with its own body', async () => {
    const env = await freshLedger();

    const responses = await Promise.all([
      ingest(env, 'first-write-wins-02', { ...CHARGE, amount: 100_000 }),
      ingest(env, 'first-write-wins-02', { ...CHARGE, amount: 900_000 }),
      ingest(env, 'first-write-wins-02', { ...CHARGE, amount: 500_000 }),
    ]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as {
      event?: { id: string; amount: number };
    }[];

    const amounts = new Set(bodies.map((body) => body.event?.amount));
    const ids = new Set(bodies.map((body) => body.event?.id));
    expect(ids.size).toBe(1);
    expect(amounts.size).toBe(1);
    expect([100_000, 500_000, 900_000]).toContain([...amounts][0]);
  });
});

describe('a write that dies half-way', () => {
  it('rolls the whole batch back, then accepts the retry exactly once', async () => {
    const env = await freshLedger();
    const eventsBefore = await count(env, 'events');
    const entriesBefore = await count(env, 'entries');
    const postingsBefore = await count(env, 'postings');
    const keysBefore = await count(env, 'idempotency');

    env.DB.failNextBatch = new Error('the connection died between the entry and the postings');
    // Hono logs the 500 it is about to return; that log is expected here, not a failure.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await ingest(env, 'interrupted-batch-03');
    quiet.mockRestore();
    expect(failed.status).toBe(500);

    // D1 batches are atomic, so a batch that throws must leave no trace at all: not the event,
    // not the entry, not the postings, and not the idempotency row that would sink the retry.
    expect(await count(env, 'events')).toBe(eventsBefore);
    expect(await count(env, 'entries')).toBe(entriesBefore);
    expect(await count(env, 'postings')).toBe(postingsBefore);
    expect(await count(env, 'idempotency')).toBe(keysBefore);

    const retried = await ingest(env, 'interrupted-batch-03');
    expect(retried.status).toBe(201);
    expect(await count(env, 'events')).toBe(eventsBefore + 1);
    expect(await count(env, 'idempotency')).toBe(keysBefore + 1);

    const replayed = await ingest(env, 'interrupted-batch-03');
    expect(replayed.status).toBe(200);
    expect(await count(env, 'events')).toBe(eventsBefore + 1);
  });
});

describe('many keys at once', () => {
  it('posts every one of them and still balances to zero', async () => {
    const env = await freshLedger();
    const before = await count(env, 'events');

    const keys = Array.from({ length: 20 }, (_, index) => `burst-key-${index.toString().padStart(4, '0')}`);
    const responses = await Promise.all(
      keys.map((key, index) => ingest(env, key, { ...CHARGE, amount: 1000 + index * 137 })),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(await count(env, 'events')).toBe(before + keys.length);

    const ledger = await balance(env);
    expect(ledger.balanced).toBe(true);
    expect(ledger.breaches).toEqual([]);

    // Per-account balances are allowed to be non-zero; the book balances when every debit in
    // it has a credit of the same size, so the totals offset and nothing else does.
    const trial = (await (await app.request('/api/summary', {}, env)).json()) as {
      trialBalance: { account: string; debit: number; credit: number }[];
    };
    const debits = trial.trialBalance.reduce((sum, line) => sum + line.debit, 0);
    const credits = trial.trialBalance.reduce((sum, line) => sum + line.credit, 0);
    expect(debits).toBe(credits);
    expect(debits).toBeGreaterThan(0);
  });
});
