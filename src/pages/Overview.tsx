import { Link } from 'react-router-dom';
import type { AnomaliesResponse, EventsResponse, SummaryResponse } from '../core/api';
import type { TrialBalanceRow } from '../core/types';
import { RiskChip } from '../components/Chip';
import { Rosette } from '../components/Rosette';
import { day, money, moneyCompact, when } from '../lib/format';
import { usePageMotion } from '../lib/motion';
import { useApi } from '../lib/useApi';

const ACCOUNT_LABEL: Record<TrialBalanceRow['account'], { name: string; kind: string }> = {
  processor_clearing: { name: 'Processor clearing', kind: 'asset' },
  merchant_payable: { name: 'Merchant payable', kind: 'liability' },
  fee_revenue: { name: 'Fee revenue', kind: 'revenue' },
  bank_settlement: { name: 'Bank settlement', kind: 'asset' },
};

export const CODE_LABEL: Record<string, string> = {
  card_testing: 'Card testing',
  velocity_spike: 'Velocity spike',
  amount_outlier: 'Ticket size outlier',
  refund_burst: 'Refund burst',
  duplicate_amount: 'Duplicate amounts',
};

export function Overview() {
  const pageRef = usePageMotion();
  const summary = useApi<SummaryResponse>('/api/summary');
  const events = useApi<EventsResponse>('/api/events?limit=8');
  const anomalies = useApi<AnomaliesResponse>('/api/anomalies');

  const data = summary.data;
  const maxScore = anomalies.data?.anomalies[0]?.score ?? 0;
  const featured = anomalies.data?.anomalies[0];
  const rest = anomalies.data?.anomalies.slice(1, 5) ?? [];
  const largest = data ? Math.max(...data.trialBalance.map((row) => Math.abs(row.net)), 1) : 1;

  return (
    <div className="page" ref={pageRef}>
      <section className="hero">
        <div className="hero__copy">
          <p className="kicker" data-reveal>
            Payment integrity · open source
          </p>
          <h1 className="display" data-reveal>
            The books
            <br />
            always balance.
          </h1>
          <p className="hero__lede" data-reveal>
            Ledgerline turns every charge, refund and payout into a balanced journal entry, then proves the trial
            balance still nets to zero. This ledger holds thirty days of synthetic traffic across six merchants, with
            four incidents planted for the detector to find.
          </p>
          <div className="hero__actions" data-reveal>
            <Link className="button button--primary" to="/journal">
              Open the journal
              <span className="button__arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <Link className="button button--ghost" to="/how">
              How it works
            </Link>
          </div>
          <p className="serial" data-reveal>
            Specimen · No. {data ? String(data.counts.events).padStart(5, '0') : '00000'} · INR ·{' '}
            {data ? day(data.window.start) : '··'} to {data ? day(data.window.end) : '··'}
          </p>
        </div>

        <aside className="note" aria-label="Ledger balance">
          <div className="note__head">
            <span className="kicker">Trial balance</span>
            <span className="note__serial">Dr − Cr</span>
          </div>
          <Rosette score={maxScore} size={360} />
          <p className="note__figure">
            0<span className="note__point">.</span>00
          </p>
          <p className="note__caption">
            {data ? data.counts.events : '—'} events, {data ? data.trialBalance.length : 4} accounts, one invariant. A
            rupee captured is a rupee owed, a rupee returned or a rupee earned.
          </p>
        </aside>
      </section>

      <section className="figures" aria-label="Ledger totals">
        {[
          { label: 'Captured', value: data?.volume.captured, note: 'successful charges' },
          { label: 'Owed to merchants', value: data?.volume.payable, note: 'net of fees, refunds and payouts' },
          { label: 'Settlement drift', value: data?.recon.drift, note: 'processor file minus ledger', drift: true },
        ].map((figure) => (
          <div className="figure" key={figure.label} data-reveal>
            <p className="kicker">{figure.label}</p>
            <p className={`figure__value ${figure.drift && (figure.value ?? 0) !== 0 ? 'is-drift' : ''}`}>
              {figure.value === undefined
                ? '—'
                : figure.drift
                  ? `${figure.value < 0 ? '−' : ''}${money(Math.abs(figure.value))}`
                  : moneyCompact(figure.value)}
            </p>
            <p className="figure__note">{figure.note}</p>
          </div>
        ))}
      </section>

      <section className="folio" aria-labelledby="trial-balance">
        <div className="folio__head">
          <span className="folio__num">01</span>
          <div>
            <h2 id="trial-balance">Four accounts, one invariant</h2>
            <p className="folio__note">
              Every entry posts a debit and a credit of the same size. If a single posting is wrong, the total stops
              being zero and the integrity sweep fails.
            </p>
          </div>
        </div>

        <div className="tb" role="table" aria-label="Trial balance">
          <div className="tb__head" role="row">
            <span role="columnheader">Account</span>
            <span role="columnheader">Debit</span>
            <span role="columnheader">Credit</span>
            <span role="columnheader">Net</span>
            <span role="columnheader" className="tb__barhead">
              Share
            </span>
          </div>
          {data
            ? data.trialBalance.map((row) => (
                <div className="tb__row" role="row" key={row.account}>
                  <span role="cell" className="tb__account">
                    <strong>{ACCOUNT_LABEL[row.account].name}</strong>
                    <em>{ACCOUNT_LABEL[row.account].kind}</em>
                  </span>
                  <span role="cell" className="tb__num">
                    {money(row.debit)}
                  </span>
                  <span role="cell" className="tb__num">
                    {money(row.credit)}
                  </span>
                  <span role="cell" className="tb__num tb__net">
                    {row.net < 0 ? '−' : ''}
                    {money(Math.abs(row.net))}
                  </span>
                  <span role="cell" className="tb__bar">
                    <span style={{ width: `${(Math.abs(row.net) / largest) * 100}%` }} />
                  </span>
                </div>
              ))
            : Array.from({ length: 4 }, (_, index) => <div className="tb__row tb__row--ghost" key={index} />)}
        </div>
        <p className="table-foot">
          Net is debit minus credit, so a liability such as merchant payable reads negative. The four net values sum to
          zero.
        </p>
      </section>

      <section className="folio" aria-labelledby="incidents">
        <div className="folio__head">
          <span className="folio__num">02</span>
          <div>
            <h2 id="incidents">Evidence, not a black box</h2>
            <p className="folio__note">
              Five rules run over the stream in order. Each one reports the counts it used, so a reviewer can agree or
              disagree with the score instead of trusting it.
            </p>
          </div>
        </div>

        {featured ? (
          <article className="feature">
            <div className="feature__score">
              <span className="feature__value">{featured.score}</span>
              <span className="kicker">risk index</span>
              <span className={`meter meter--${featured.severity}`} aria-hidden="true">
                <span style={{ width: `${featured.score}%` }} />
              </span>
            </div>
            <div className="feature__body">
              <p className="kicker">{CODE_LABEL[featured.code] ?? featured.code}</p>
              <h3>
                {featured.merchantName}, {featured.event ? money(featured.event.amount) : ''}
              </h3>
              <ul className="reasons">
                {featured.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="feature__meta">
                {featured.event ? when(featured.event.occurredAt) : ''} IST · {featured.eventId}
              </p>
            </div>
            <div className="feature__action">
              <Link className="link" to="/risk">
                All {anomalies.data?.anomalies.length ?? 0} findings
              </Link>
            </div>
          </article>
        ) : (
          <p className="empty">{anomalies.loading ? 'Scoring the stream…' : 'No findings. The ledger is quiet.'}</p>
        )}

        {rest.length > 0 && (
          <ol className="findings">
            {rest.map((finding) => (
              <li key={`${finding.eventId}-${finding.code}`} className="findings__row">
                <span className="findings__code">{CODE_LABEL[finding.code] ?? finding.code}</span>
                <span className="findings__merchant">{finding.merchantName}</span>
                <span className="findings__when">{finding.event ? when(finding.event.occurredAt) : ''}</span>
                <RiskChip score={finding.score} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="folio" aria-labelledby="stream">
        <div className="folio__head">
          <span className="folio__num">03</span>
          <div>
            <h2 id="stream">Every movement, posted</h2>
            <p className="folio__note">The last eight events, newest first. Open the journal for the double-entry view.</p>
          </div>
        </div>

        <div className="stream" role="table" aria-label="Recent events">
          <div className="stream__head" role="row">
            <span role="columnheader">Time</span>
            <span role="columnheader">Merchant</span>
            <span role="columnheader">Event</span>
            <span role="columnheader">Amount</span>
            <span role="columnheader">Risk</span>
          </div>
          {events.data
            ? events.data.events.map((event) => (
                <div className="stream__row" role="row" key={event.id}>
                  <span role="cell" className="mono muted">
                    {when(event.occurredAt)}
                  </span>
                  <span role="cell">{event.merchantName}</span>
                  <span role="cell" className="mono event-type">
                    {event.type}
                  </span>
                  <span role="cell" className="mono stream__amount">
                    {money(event.amount)}
                  </span>
                  <span role="cell">
                    <RiskChip score={event.risk} />
                  </span>
                </div>
              ))
            : Array.from({ length: 8 }, (_, index) => <div className="stream__row stream__row--ghost" key={index} />)}
        </div>
      </section>

      <section className="folio folio--split" aria-labelledby="recon">
        <div className="folio__head">
          <span className="folio__num">04</span>
          <div>
            <h2 id="recon">The processor said one thing</h2>
            <p className="folio__note">
              A settlement file is the processor's account of what it owes. Reconciling means joining it to the ledger
              on the event id and explaining every row that does not match.
            </p>
            <p className="folio__note">
              The seeded file carries three defects: a row the ledger never captured, a captured charge that never
              settled, and a fee that drifted by 25.00.
            </p>
            <Link className="link" to="/recon">
              Open reconciliation
            </Link>
          </div>
          <div className="recon-figure">
            <p className="kicker">Drift</p>
            <p className="recon-figure__value is-drift">{data ? money(data.recon.drift) : '—'}</p>
            <dl className="recon-figure__list">
              <div>
                <dt>Rows checked</dt>
                <dd>{data?.recon.checked ?? '—'}</dd>
              </div>
              <div>
                <dt>Matched</dt>
                <dd>{data?.recon.matched ?? '—'}</dd>
              </div>
              <div>
                <dt>Exceptions</dt>
                <dd>
                  {data
                    ? data.recon.missingInLedger + data.recon.missingInSettlement + data.recon.feeMismatch + data.recon.amountMismatch
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
