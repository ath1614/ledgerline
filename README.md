# Ledgerline

**Double-entry payment integrity, proved on every request.**

Ledgerline posts every charge, refund and payout as a balanced journal entry, scores the stream
with explainable risk rules, and reconciles a processor settlement file against the books. The
demo ledger holds 30 days of synthetic traffic across six merchants, with four incidents planted
so the detector can be graded against known answers.

Live: **https://site-0d8b21eb9da849cc99a7c23ecb9589aa.freebuff.page**

## Why

Most payment bugs are accounting bugs. A retried request charges twice, a refund outruns the
captured funds, a fee drifts by 25 rupees in a settlement file. Those failures are invisible in a
dashboard that shows a total. They are obvious in a ledger that has to balance.

Ledgerline is an attempt to make the invariant the product: money moves as postings, postings
balance by construction, and every screen can be traced back to a journal entry.

## What it does

- **Postings, not updates.** `charge.succeeded` debits processor clearing and credits merchant
  payable plus fee revenue. A refund reverses it. A payout moves the obligation into the bank.
- **Integers only.** Every amount is an integer in minor units. Rounding happens once, half away
  from zero, when a fee is computed.
- **Idempotent ingest.** `POST /api/events` requires an `Idempotency-Key`. Event, entry, postings
  and key land in one atomic D1 batch, so a retry returns the first result instead of charging twice.
- **Explainable risk.** Five rules run in stream order and report the counts that fired them. No
  model, no hidden score.
- **Settlement reconciliation.** The processor file is joined on the event id; missing rows, fee
  drift and amount drift become a dispute CSV.

## Architecture

```
src/core/        pure TypeScript: money, postings, trial balance, rules, recon, seed
src/server/      Hono on Cloudflare Workers, D1 repository, schema and seed
src/pages/       React app: overview, journal, risk, reconciliation, how it works
src/components/  rosette, risk chip
```

The core has no framework imports. The Worker, the browser and the test suite all run the same
posting rules. See [ARCHITECTURE.md](ARCHITECTURE.md) for the decisions and the trade-offs.

## API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Ledger counts plus the integrity sweep |
| `GET` | `/api/summary` | Totals, trial balance, finding counts, recon status |
| `GET` | `/api/events` | Newest first, `limit`, `before`, `merchant`, `type` |
| `GET` | `/api/journal` | Entries with postings, newest first |
| `GET` | `/api/anomalies` | Findings with evidence and the event behind each |
| `GET` | `/api/recon` | Reconciliation report and dispute CSV |
| `POST` | `/api/events` | Ingest one event, requires `Idempotency-Key` |
| `POST` | `/api/demo/burst` | Plant a card-testing burst in the live demo |

```bash
curl -X POST http://127.0.0.1:8787/api/events \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: demo-2026-10-30-0001' \
  -d '{"type":"charge.succeeded","merchantId":"mch_kettle","amount":129900}'
```

## Tests

```bash
npm test
```

41 tests on Vitest, including a fast-check property that asserts conservation of value for 500
generated amount and fee pairs, a seeded 30 day fixture that must balance to zero, negative cases
for unbalanced entries, and a regression for each planted incident.

## Run locally

```bash
npm install
npm run dev:api     # Worker and local D1 on :8787
npm run dev         # Vite app on :5173, proxying /api
```

The first request to the Worker creates the schema and seeds the ledger. Local D1 state lives in
`.wrangler/state`; delete it to reseed.

## Build and deploy

```bash
npm run build          # typecheck, bundle the SPA
npm run build:deploy   # bundle the Worker and assemble deploy/
```

`deploy/` contains the Worker, the static assets and a manifest for the hosting target. The same
build runs locally under `wrangler dev`.

## Limits

This is a demonstration, not a processor. It stores a card summary rather than a card, the rules
are hand written rather than learned, and findings are recomputed per request over the demo stream.
A production ledger would normalise reporting tables and move detection to a queue.

## License

MIT. See [LICENSE](LICENSE).

Built by [Atharv Soni](https://github.com/ath1614).

## Learn it

New to this codebase? [GUIDE.md](GUIDE.md) explains it in plain English, from the idea to the tests.
