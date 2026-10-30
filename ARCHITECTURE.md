# Architecture

## Shape

```
                    ┌──────────────────────────────┐
  browser ────────▶ │  Worker (Hono)               │
                    │  /api/*  ──▶ domain core     │
                    │  *       ──▶ ASSETS          │
                    └──────────────┬───────────────┘
                                   │
                            ┌──────▼──────┐
                            │  D1 SQLite  │
                            │  events     │
                            │  entries    │
                            │  postings   │
                            │  settlement │
                            │  idempotency│
                            └─────────────┘
```

The React app ships as a prebuilt bundle served by the same Worker as the API; the ledger lives in
D1 and every screen is filled from a fetch.

## Decisions

**Money is an integer, everywhere.** `amount` and `fee` are minor units. The only division is
`divRoundHalfUp`, which takes two integers and rounds half away from zero using integer arithmetic.
A float never reaches a balance. Currency is stored beside every amount because the plan is to
support more than INR without changing the schema.

**Postings are derived, then stored.** `postingsFor(event)` is a pure function. The Worker calls it
before writing, so an unbalanced entry can never reach D1. The API then reads postings back out of
the database rather than recomputing them, which means the trial balance on screen is a statement
about what is actually stored.

**Four writes, one batch.** `postEvent` sends the event, its entry, its postings and the
idempotency record to `db.batch`. D1 executes a batch atomically. Two concurrent retries with the
same key race past the initial read, the loser fails the unique constraint, and the handler returns
the winner. That is the whole exactly-once story, and it is testable.

**Risk is a set of rules, not a model.** Each rule is a question an operations team would ask
(card testing, velocity, ticket size, refund burst, repeated amounts) with a cooldown so one
incident produces one finding. The score is the weight of the rule that fired, and the finding
carries its evidence. A rule that cannot explain itself does not ship.

**Reconciliation joins on the event id.** Amounts collide and timestamps drift, so neither is safe
to match on. The event id is minted once, stored beside the entry and echoed in the settlement file.

## Trade-offs

- **Findings are computed per request.** At 410 events this costs a few milliseconds. At a million
  events it would not, and detection would move to a queue with a materialised findings table.
- **The settlement file is stored as rows, not imported from a processor.** Importing is the next
  step; the reconciliation function is already pure and takes rows.
- **Card data is a summary.** `{brand, last4, country}` is enough to make the stream legible and
  keeps the demo free of anything resembling card data.
- **No authentication.** Every route is read-only except ingest and the demo burst, and the data is
  synthetic. Auth is deliberately out of scope for a public demo.

## Failure modes the tests cover

| Failure | Test |
| --- | --- |
| Fee exceeds the captured amount | `posting.test.ts` |
| A posting is edited after the fact | `ledger.test.ts` |
| A refund outruns captured funds | `ledger.test.ts` |
| The seed generator pays out more than is owed | `seed.test.ts` |
| A rule fires on clean traffic | `anomalies.test.ts` |
| A settlement row never captured | `recon.test.ts` |
| A fee drifts by 100 minor units | `recon.test.ts` |

## Next

1. Import a processor CSV instead of the seeded settlement rows.
2. Move detection to a Durable Object or queue with a findings table.
3. Add a second currency and a trial balance per currency.
4. Expose the dispute CSV as a signed download with an audit trail.
