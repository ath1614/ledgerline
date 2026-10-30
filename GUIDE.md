# Ledgerline — the beginner's guide

## 1. What is this thing?

A payment business moves money: a customer is charged, sometimes refunded, and later paid out. Most
software stores that as a row that gets edited — `status: paid`, then `status: refunded`.

Ledgerline does it the way an accountant does: every movement is written as a **journal entry with
two sides** that must balance. A ₹1,000 charge is not "money in"; it is:

```
debit   processor clearing       ₹1,000
credit  merchant payable          ₹970
credit  fee revenue                ₹30
```

Debits minus credits must equal zero. Always. If a bug makes them not equal, the ledger refuses the
entry instead of silently storing a wrong number.

## 2. The one idea

> The invariant is the product: an entry that does not balance cannot exist.

## 3. How a request travels

```
POST /api/events  (Idempotency-Key: abc)
        │
        ├─ seen this key?  ── yes ─▶ return the first result, change nothing
        │
        ├─ validate the event (type, merchant, integer amount, fee ≤ amount)
        ├─ build the entry from posting rules      (src/core/posting.ts)
        ├─ write event + entry + postings + key in ONE D1 batch
        ▼
     201 { event, entry }
```

The batch is the trick: a retry cannot half-apply. Two simultaneous retries race past the read, but
the unique key makes the loser fail — and the handler then returns the winner.

## 4. Files, in reading order

| File | What it is |
| --- | --- |
| `src/core/money.ts` | Integer minor units, one rounding rule. |
| `src/core/posting.ts` | Event type → balanced postings. |
| `src/core/ledger.ts` | Trial balance, breaches, merchant totals. |
| `src/core/recon.ts` | Settlement file vs the books, and the dispute CSV. |
| `src/core/anomalies.ts` | Five explainable risk rules. |
| `src/server/schema.ts` | Tables and the 30-day seeded ledger. |
| `src/pages/*` | Overview, journal, risk, recon. |

## 5. Run it

```bash
npm install
npm run dev:api    # Worker + local D1 on :8787
npm run dev        # site on :5173
npm test           # 45 tests, including the concurrency and crash-recovery cases
```

## 6. Words you will meet

| Word | Meaning here |
| --- | --- |
| **Double-entry** | Every movement has a debit and a credit of the same size. |
| **Trial balance** | Sum of all debits minus credits; must be zero. |
| **Posting** | One side of an entry (account + debit/credit + amount). |
| **Idempotency key** | A client-supplied id that makes a repeat request harmless. |
| **Reconciliation** | Comparing the processor's settlement file to your books. |

## 7. Try these

1. In `posting.ts`, make the fee credit the wrong account. Which test fails first?
2. Call `POST /api/events` twice with the same `Idempotency-Key`. Confirm one event and one entry
   exist, then explain which table made the second call safe.
3. Delete a settlement row in `.wrangler/state` and reload `/api/recon`. Find the finding it creates.
4. Change one amount from integer paise to a float and watch where the balance check catches it.

## 8. Limits

It is a demonstration ledger: findings are recomputed per request, the risk rules are hand-written,
and only a card summary is stored. A production ledger would normalise reporting tables and move
detection to a queue.
