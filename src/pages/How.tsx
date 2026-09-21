import { usePageMotion } from '../lib/motion';

const RULES = [
  ['charge.succeeded', 'processor clearing', 'gross', 'merchant payable + fee revenue', 'gross − fee, fee'],
  ['refund.succeeded', 'merchant payable', 'amount', 'processor clearing', 'amount'],
  ['payout.paid', 'merchant payable', 'amount', 'bank settlement', 'amount'],
  ['charge.failed', 'nothing moves', '—', 'the attempt is still evidence', '—'],
];

export function How() {
  const pageRef = usePageMotion();

  return (
    <div className="page page--inner" ref={pageRef}>
      <header className="page-head">
        <p className="kicker" data-reveal>
          Architecture · how it works
        </p>
        <h1 className="display display--inner" data-reveal>
          Post once. Prove it twice.
        </h1>
        <p className="page-head__lede" data-reveal>
          Ledgerline is a Worker, a D1 database and a React app over one shared core. The core is pure TypeScript with
          no framework imports, so the same posting rules and the same reconciliation code run in the browser, in the
          test suite and on the edge.
        </p>
      </header>

      <section className="folio folio--prose">
        <div className="folio__head">
          <span className="folio__num">01</span>
          <div>
            <h2>One request, four writes</h2>
            <ol className="steps">
              <li>
                <strong>Validate.</strong> The body is checked for a known merchant, a known event type and an integer
                amount in minor units.
              </li>
              <li>
                <strong>Look up the idempotency key.</strong> A repeat of the same key returns the first event with
                <code> replayed: true</code> and writes nothing.
              </li>
              <li>
                <strong>Derive the postings.</strong> The core turns the event into a balanced entry. An unbalanced entry
                is refused before it reaches the database.
              </li>
              <li>
                <strong>Write atomically.</strong> Event, entry, postings and key go into one D1 batch. If two retries
                race, the unique key makes the loser fail and the handler returns the winner.
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section className="folio" aria-labelledby="rules">
        <div className="folio__head">
          <span className="folio__num">02</span>
          <div>
            <h2 id="rules">The four posting rules</h2>
            <p className="folio__note">
              Amounts are integers in minor units. No float ever touches a balance, and rounding happens once, half away
              from zero, at the point a fee is computed.
            </p>
          </div>
        </div>
        <div className="rules" role="table" aria-label="Posting rules">
          <div className="rules__head" role="row">
            <span role="columnheader">Event</span>
            <span role="columnheader">Debit</span>
            <span role="columnheader">Credit</span>
            <span role="columnheader">Memo</span>
          </div>
          {RULES.map(([event, debitAccount, debitAmount, creditAccount, creditAmount]) => (
            <div className="rules__row" role="row" key={event}>
              <span role="cell" className="mono">
                {event}
              </span>
              <span role="cell" className="mono">
                {debitAccount}
                <em>{debitAmount}</em>
              </span>
              <span role="cell" className="mono">
                {creditAccount}
                <em>{creditAmount}</em>
              </span>
              <span role="cell" className="muted">
                balanced by construction
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="folio folio--split" aria-labelledby="tested">
        <div className="folio__head">
          <span className="folio__num">03</span>
          <div>
            <h2 id="tested">What is actually tested</h2>
            <p className="folio__note">
              41 tests run on Vitest. Money rounding, posting rules, the trial balance, every detector rule, the
              reconciliation join and the seed generator all have direct coverage, plus a fast-check property that
              asserts conservation of value for any amount and fee.
            </p>
            <ul className="plain-list">
              <li>Property: every charge balances, for 500 generated amount and fee pairs.</li>
              <li>Fixture: the seeded ledger balances to exactly zero and never overpays a merchant.</li>
              <li>Negative cases: a fee larger than the charge and a refund larger than captured funds both fail.</li>
              <li>Regression: each of the four planted incidents is detected, and an even stream produces no findings.</li>
            </ul>
          </div>
          <div className="note note--flat">
            <p className="kicker">Run it</p>
            <pre className="code">
              <code>{`npm install
npm test
npm run dev:api   # worker on :8787
npm run dev       # app on :5173`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="folio folio--prose">
        <div className="folio__head">
          <span className="folio__num">04</span>
          <div>
            <h2>What this is not</h2>
            <p className="folio__note">
              This is a demonstration, not a payment processor. It does not talk to a card network, it stores a card
              summary rather than a card, and the risk rules are hand written rather than learned. Findings are
              recomputed per request over the full demo stream; a production ledger would move them to a materialised
              queue.
            </p>
            <p className="folio__note">
              The interesting part is the invariant. Any feature added here has to keep the trial balance at zero, and
              the test suite will say so.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
