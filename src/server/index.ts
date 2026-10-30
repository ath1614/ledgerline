import { Hono } from 'hono';
import { detectAnomalies, riskScoreFor, summariseFindings } from '../core/anomalies';
import type {
  AnomaliesResponse,
  EventsResponse,
  JournalResponse,
  ReconResponse,
  SummaryResponse,
} from '../core/api';
import { findBreaches, merchantTotals, trialBalance } from '../core/ledger';
import { processorFee } from '../core/money';
import { entryBalance } from '../core/posting';
import { reconcile, reconciliationCsv } from '../core/recon';
import { MERCHANTS } from '../core/seed';
import { EVENT_TYPES, type Currency, type PaymentEvent } from '../core/types';
import type { Env } from './env';
import { LedgerRepo } from './repo';
import { ensureSchema, ensureSeed } from './schema';

const app = new Hono<{ Bindings: Env }>();
const repoCache = new WeakMap<object, LedgerRepo>();

function repoFor(env: Env): LedgerRepo {
  let repo = repoCache.get(env.DB);
  if (!repo) {
    repo = new LedgerRepo(env.DB);
    repoCache.set(env.DB, repo);
  }
  return repo;
}

/**
 * Create the schema and demo ledger once per database, and retry on the next request if it
 * failed. Keyed by the binding rather than by module, so a test can hold two fresh databases
 * in one process and still get each of them seeded.
 */
const readiness = new WeakMap<object, Promise<void>>();

function ensureReady(env: Env): Promise<void> {
  let ready = readiness.get(env.DB);
  if (!ready) {
    ready = (async () => {
      await ensureSchema(env.DB);
      await ensureSeed(env.DB);
    })().catch((error) => {
      readiness.delete(env.DB);
      throw error;
    });
    readiness.set(env.DB, ready);
  }
  return ready;
}

const merchantName = (id: string): string => MERCHANTS.find((merchant) => merchant.id === id)?.name ?? id;

function eventViews(events: PaymentEvent[], findings: ReturnType<typeof detectAnomalies>) {
  return events.map((event) => ({
    ...event,
    merchantName: merchantName(event.merchantId),
    risk: riskScoreFor(event.id, findings),
    findingCodes: findings.filter((finding) => finding.eventId === event.id).map((finding) => finding.code),
  }));
}

app.use('/api/*', async (context, next) => {
  await ensureReady(context.env);
  await next();
});

app.get('/api/health', async (context) => {
  const events = await repoFor(context.env).allEvents();
  const entries = await repoFor(context.env).allEntries();
  const breaches = findBreaches(entries);
  return context.json({
    ok: true,
    events: events.length,
    entries: entries.length,
    balanced: breaches.length === 0,
    breaches: breaches.slice(0, 5),
  });
});

app.get('/api/summary', async (context) => {
  const repo = repoFor(context.env);
  const [events, entries, settlement] = await Promise.all([repo.allEvents(), repo.allEntries(), repo.settlement()]);
  const findings = detectAnomalies(events);
  const summary = summariseFindings(findings);
  const trial = trialBalance(entries);
  const recon = reconcile(events, settlement);

  const charges = events.filter((event) => event.type === 'charge.succeeded');
  const refunds = events.filter((event) => event.type === 'refund.succeeded');
  const payouts = events.filter((event) => event.type === 'payout.paid');
  const failed = events.filter((event) => event.type === 'charge.failed');

  const volume = {
    captured: charges.reduce((sum, event) => sum + event.amount, 0),
    fees: charges.reduce((sum, event) => sum + event.fee, 0),
    refunded: refunds.reduce((sum, event) => sum + event.amount, 0),
    paidOut: payouts.reduce((sum, event) => sum + event.amount, 0),
    payable: MERCHANTS.reduce((sum, merchant) => sum + merchantTotals(entries, merchant.id).payable, 0),
  };

  const payload: SummaryResponse = {
    window: await repo.meta('window', {
      start: events[0]?.occurredAt ?? 0,
      end: events[events.length - 1]?.occurredAt ?? 0,
    }),
    counts: {
      events: events.length,
      charges: charges.length,
      refunds: refunds.length,
      payouts: payouts.length,
      failed: failed.length,
      flaggedEvents: summary.flaggedEvents,
    },
    volume,
    trialBalance: trial,
    findings: summary,
    recon: {
      clean: recon.clean,
      checked: recon.checked,
      matched: recon.matched,
      drift: recon.drift,
      missingInLedger: recon.missingInLedger.length,
      missingInSettlement: recon.missingInSettlement.length,
      feeMismatch: recon.feeMismatch.length,
      amountMismatch: recon.amountMismatch.length,
    },
    merchants: MERCHANTS,
    plants: await repo.meta('plants', []),
    seededAt: Number(await repo.meta('ledgerline.seeded', 0)),
  };
  return context.json(payload);
});

app.get('/api/events', async (context) => {
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 25)));
  const beforeRaw = context.req.query('before');
  const before = beforeRaw ? Number(beforeRaw) : undefined;
  const merchant = context.req.query('merchant') || undefined;
  const type = context.req.query('type') || undefined;

  const repo = repoFor(context.env);
  const [page, all] = await Promise.all([
    repo.eventsPage({ limit, before, merchant, type }),
    repo.allEvents(),
  ]);
  const findings = detectAnomalies(all);
  const payload: EventsResponse = {
    events: eventViews(page.items, findings),
    nextBefore: page.nextBefore,
  };
  return context.json(payload);
});

app.get('/api/journal', async (context) => {
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 25)));
  const beforeRaw = context.req.query('before');
  const before = beforeRaw ? Number(beforeRaw) : undefined;

  const repo = repoFor(context.env);
  const [page, all] = await Promise.all([repo.journalPage({ limit, before }), repo.allEvents()]);
  const findings = detectAnomalies(all);
  const payload: JournalResponse = {
    entries: page.items.map((entry) => ({
      ...entry,
      merchantName: merchantName(entry.merchantId),
      risk: riskScoreFor(entry.eventId, findings),
    })),
    nextBefore: page.nextBefore,
  };
  return context.json(payload);
});

app.get('/api/anomalies', async (context) => {
  const repo = repoFor(context.env);
  const events = await repo.allEvents();
  const byId = new Map(events.map((event) => [event.id, event]));
  const findings = detectAnomalies(events);
  const payload: AnomaliesResponse = {
    anomalies: findings.map((finding) => ({
      ...finding,
      merchantName: merchantName(finding.merchantId),
      event: byId.get(finding.eventId) ?? null,
    })),
  };
  return context.json(payload);
});

app.get('/api/recon', async (context) => {
  const currency = (context.req.query('currency') ?? 'INR') as Currency;
  const repo = repoFor(context.env);
  const [events, settlement] = await Promise.all([repo.allEvents(), repo.settlement()]);
  const report = reconcile(events, settlement, currency);
  const byId = new Map(events.map((event) => [event.id, event]));

  const payload: ReconResponse = {
    ...report,
    currency,
    csv: reconciliationCsv(report),
    rows: [
      ...report.missingInLedger.map((eventId) => ({
        eventId,
        issue: 'missing_in_ledger' as const,
        ledger: null,
        settled: settlement.find((row) => row.eventId === eventId)?.net ?? null,
        merchantName: merchantName(settlement.find((row) => row.eventId === eventId)?.merchantId ?? ''),
        occurredAt: null,
      })),
      ...report.missingInSettlement.map((eventId) => ({
        eventId,
        issue: 'missing_in_settlement' as const,
        ledger: byId.get(eventId) ? byId.get(eventId)!.amount - byId.get(eventId)!.fee : null,
        settled: null,
        merchantName: merchantName(byId.get(eventId)?.merchantId ?? ''),
        occurredAt: byId.get(eventId)?.occurredAt ?? null,
      })),
      ...report.feeMismatch.map((item) => ({
        eventId: item.eventId,
        issue: 'fee_mismatch' as const,
        ledger: item.ledgerFee,
        settled: item.settledFee,
        merchantName: merchantName(byId.get(item.eventId)?.merchantId ?? ''),
        occurredAt: byId.get(item.eventId)?.occurredAt ?? null,
      })),
      ...report.amountMismatch.map((item) => ({
        eventId: item.eventId,
        issue: 'amount_mismatch' as const,
        ledger: item.ledgerAmount,
        settled: item.settledAmount,
        merchantName: merchantName(byId.get(item.eventId)?.merchantId ?? ''),
        occurredAt: byId.get(item.eventId)?.occurredAt ?? null,
      })),
    ],
  };
  return context.json(payload);
});

interface IngestBody {
  type?: string;
  merchantId?: string;
  amount?: number;
  fee?: number;
  occurredAt?: number;
  card?: PaymentEvent['card'];
}

app.post('/api/events', async (context) => {
  const key = context.req.header('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 200) {
    return context.json({ error: 'An Idempotency-Key header of 8 to 200 characters is required' }, 400);
  }

  const repo = repoFor(context.env);
  const existing = await repo.findIdempotent(key);
  if (existing) {
    const event = await repo.eventById(existing);
    return context.json({ event, replayed: true });
  }

  let body: IngestBody;
  try {
    body = await context.req.json<IngestBody>();
  } catch {
    return context.json({ error: 'Body must be JSON' }, 400);
  }

  const merchant = body.merchantId ? repo.merchant(body.merchantId) : undefined;
  if (!merchant) return context.json({ error: 'Unknown merchantId' }, 422);
  if (!body.type || !EVENT_TYPES.includes(body.type as PaymentEvent['type'])) {
    return context.json({ error: `type must be one of ${EVENT_TYPES.join(', ')}` }, 422);
  }
  if (!Number.isInteger(body.amount) || (body.amount as number) < 0 || (body.amount as number) > 1_000_000_000_000) {
    return context.json({ error: 'amount must be an integer number of minor units under 10^12' }, 422);
  }

  const amount = body.amount as number;
  const rawFee =
    body.type === 'charge.succeeded'
      ? body.fee ?? processorFee(amount, merchant.feeBps, merchant.feeFixed)
      : 0;
  if (!Number.isInteger(rawFee) || rawFee < 0 || rawFee > amount) {
    return context.json({ error: 'fee must be a non-negative integer no larger than amount' }, 422);
  }

  const event: PaymentEvent = {
    id: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: body.type as PaymentEvent['type'],
    merchantId: merchant.id,
    currency: 'INR',
    amount,
    fee: rawFee,
    occurredAt: Number.isFinite(body.occurredAt) ? Number(body.occurredAt) : Date.now(),
    ...(body.card ? { card: body.card } : {}),
  };

  try {
    const entry = await repo.postEvent(event, key);
    if (entryBalance(entry) !== 0) {
      return context.json({ error: 'Refusing to post an unbalanced entry' }, 500);
    }
    return context.json({ event, entry, replayed: false }, 201);
  } catch (error) {
    // Two concurrent retries can race past the read above. The unique key makes the
    // second write fail atomically; return the winner instead of a duplicate charge.
    const winner = await repo.findIdempotent(key);
    if (winner) {
      return context.json({ event: await repo.eventById(winner), replayed: true });
    }
    throw error;
  }
});

app.post('/api/demo/burst', async (context) => {
  const repo = repoFor(context.env);
  const merchant = MERCHANTS.find((candidate) => candidate.id === 'mch_lantern')!;
  const now = Date.now();
  const inserted: string[] = [];

  for (let index = 0; index < 6; index += 1) {
    const amount = 200 + index * 100;
    const event: PaymentEvent = {
      id: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
      type: 'charge.succeeded',
      merchantId: merchant.id,
      currency: 'INR',
      amount,
      fee: Math.min(amount, processorFee(amount, merchant.feeBps, merchant.feeFixed)),
      occurredAt: now - (6 - index) * 30_000,
      card: { brand: 'visa', last4: `90${10 + index}`, country: 'US' },
    };
    await repo.postEvent(event, `demo-burst-${now}-${index}`);
    inserted.push(event.id);
  }

  return context.json({ inserted, merchant: merchant.name, took: '6 charges in 3 minutes' }, 201);
});

app.all('/api/*', (context) => context.json({ error: 'Not found' }, 404));

/** Serve the built SPA, falling back to index.html for client-side routes. */
app.all('*', async (context) => {
  const response = await context.env.ASSETS.fetch(context.req.raw);
  if (response.status !== 404) return response;
  const url = new URL(context.req.url);
  if (url.pathname.includes('.')) return response;
  return context.env.ASSETS.fetch(new URL('/', url).toString());
});

export default app;
