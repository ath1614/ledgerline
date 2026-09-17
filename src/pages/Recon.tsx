import type { ReconResponse } from '../core/api';
import { money, when } from '../lib/format';
import { usePageMotion } from '../lib/motion';
import { useApi } from '../lib/useApi';

const ISSUE_LABEL: Record<ReconResponse['rows'][number]['issue'], string> = {
  missing_in_ledger: 'Settled, never captured',
  missing_in_settlement: 'Captured, never settled',
  fee_mismatch: 'Fee differs',
  amount_mismatch: 'Amount differs',
};

export function Recon() {
  const pageRef = usePageMotion();
  const { data, error, loading } = useApi<ReconResponse>('/api/recon?currency=INR');

  function download() {
    if (!data) return;
    const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ledgerline-reconciliation.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page page--inner" ref={pageRef}>
      <header className="page-head">
        <p className="kicker" data-reveal>
          Reconciliation · INR
        </p>
        <h1 className="display display--inner" data-reveal>
          Three rows do not match.
        </h1>
        <p className="page-head__lede" data-reveal>
          The settlement file is joined to the ledger on the event id. Each exception below is one of the three ways a
          month end goes wrong: money settled that was never captured, money captured that never settled, or a fee that
          grew on the way.
        </p>
      </header>

      {error && <p className="empty">Reconciliation failed: {error}</p>}

      <section className="folio" aria-label="Reconciliation summary">
        <div className="recon-head">
          <div>
            <p className="kicker">Drift</p>
            <p className="recon-figure__value is-drift">{data ? money(data.drift) : '—'}</p>
            <p className="table-foot">
              {data?.clean ? 'The file agrees with the ledger.' : 'Settlement net minus ledger net for captured charges.'}
            </p>
          </div>
          <dl className="recon-head__stats">
            <div>
              <dt>Charges checked</dt>
              <dd className="mono">{data?.checked ?? '—'}</dd>
            </div>
            <div>
              <dt>Matched</dt>
              <dd className="mono">{data?.matched ?? '—'}</dd>
            </div>
            <div>
              <dt>Ledger net</dt>
              <dd className="mono">{data ? money(data.ledgerNet) : '—'}</dd>
            </div>
            <div>
              <dt>Settled net</dt>
              <dd className="mono">{data ? money(data.settledNet) : '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="recon-table" role="table" aria-label="Reconciliation exceptions">
          <div className="recon-table__head" role="row">
            <span role="columnheader">Event</span>
            <span role="columnheader">Issue</span>
            <span role="columnheader">Merchant</span>
            <span role="columnheader">Ledger</span>
            <span role="columnheader">Settled</span>
            <span role="columnheader">When</span>
          </div>
          {loading && <div className="recon-table__row recon-table__row--ghost" />}
          {data?.rows.map((row) => (
            <div className="recon-table__row" role="row" key={row.eventId} data-reveal>
              <span role="cell" className="mono">
                {row.eventId}
              </span>
              <span role="cell">{ISSUE_LABEL[row.issue]}</span>
              <span role="cell">{row.merchantName}</span>
              <span role="cell" className="mono">
                {row.ledger === null ? '—' : money(row.ledger)}
              </span>
              <span role="cell" className="mono">
                {row.settled === null ? '—' : money(row.settled)}
              </span>
              <span role="cell" className="mono muted">
                {row.occurredAt ? when(row.occurredAt) : '—'}
              </span>
            </div>
          ))}
        </div>

        <div className="recon-actions">
          <button className="button button--primary" type="button" onClick={download} disabled={!data}>
            Download dispute CSV
          </button>
          <p className="table-foot">
            Four columns: event id, issue, ledger minor units, settled minor units. Small enough to paste into a
            processor support ticket.
          </p>
        </div>
      </section>

      <section className="folio folio--prose">
        <div className="folio__head">
          <span className="folio__num">05</span>
          <div>
            <h2>Why the event id is the join key</h2>
            <p className="folio__note">
              Amounts collide and timestamps drift, so neither is safe to match on. The event id is minted once when a
              charge is created, stored beside the ledger entry and echoed by the processor in its settlement file. That
              makes the join exact, and makes a missing row unambiguous.
            </p>
            <p className="folio__note">
              Fees are compared as integers in minor units. A one paisa drift is still drift: the ledger refuses to
              round a difference away.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
