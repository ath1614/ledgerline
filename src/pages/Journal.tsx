import { useState } from 'react';
import { RiskChip } from '../components/Chip';
import type { JournalResponse } from '../core/api';
import { money, when } from '../lib/format';
import { usePageMotion } from '../lib/motion';
import { useApi } from '../lib/useApi';

export function Journal() {
  const pageRef = usePageMotion();
  const [limit, setLimit] = useState(20);
  const { data, error, loading } = useApi<JournalResponse>(`/api/journal?limit=${limit}`);

  return (
    <div className="page page--inner" ref={pageRef}>
      <header className="page-head">
        <p className="kicker" data-reveal>
          Journal · double entry
        </p>
        <h1 className="display display--inner" data-reveal>
          Every entry has two sides.
        </h1>
        <p className="page-head__lede" data-reveal>
          A charge debits processor clearing and credits the merchant plus fee revenue. A refund reverses it. A payout
          moves the obligation into the bank. Sum the debits and credits in any entry and you get zero.
        </p>
      </header>

      <section className="folio" aria-label="Journal entries">
        <div className="entry-table">
          <div className="entry-table__head">
            <span>Posted</span>
            <span>Merchant</span>
            <span>Memo</span>
            <span>Amount</span>
            <span>Risk</span>
          </div>

          {error && <p className="empty">The journal could not load: {error}</p>}

          {data?.entries.map((entry) => {
            const total = entry.postings
              .filter((posting) => posting.side === 'debit')
              .reduce((sum, posting) => sum + posting.amount, 0);
            return (
              <details className="entry" key={entry.id} data-reveal>
                <summary className="entry__summary">
                  <span className="mono muted">{when(entry.occurredAt)}</span>
                  <span>{entry.merchantName}</span>
                  <span className="entry__memo">{entry.memo}</span>
                  <span className="mono entry__amount">{money(total)}</span>
                  <RiskChip score={entry.risk} />
                </summary>
                <div className="entry__body">
                  <div className="entry__postings" role="table" aria-label={`Postings for ${entry.id}`}>
                    <div className="entry__postings-head" role="row">
                      <span role="columnheader">Account</span>
                      <span role="columnheader">Debit</span>
                      <span role="columnheader">Credit</span>
                    </div>
                    {entry.postings.map((posting, index) => (
                      <div className="entry__posting" role="row" key={`${entry.id}-${index}`}>
                        <span role="cell" className="mono">
                          {posting.account}
                        </span>
                        <span role="cell" className="mono entry__num">
                          {posting.side === 'debit' ? money(posting.amount) : ''}
                        </span>
                        <span role="cell" className="mono entry__num">
                          {posting.side === 'credit' ? money(posting.amount) : ''}
                        </span>
                      </div>
                    ))}
                    <div className="entry__posting entry__posting--total" role="row">
                      <span role="cell">Balanced</span>
                      <span role="cell" className="mono entry__num">
                        {money(entry.postings.filter((p) => p.side === 'debit').reduce((s, p) => s + p.amount, 0))}
                      </span>
                      <span role="cell" className="mono entry__num">
                        {money(entry.postings.filter((p) => p.side === 'credit').reduce((s, p) => s + p.amount, 0))}
                      </span>
                    </div>
                  </div>
                  <p className="entry__id mono">{entry.id}</p>
                </div>
              </details>
            );
          })}

          {loading && <div className="entry entry--ghost" />}

          <div className="entry-table__foot">
            <p className="table-foot">
              Showing {data?.entries.length ?? 0} of the newest entries. Timestamps are IST.
            </p>
            {data?.nextBefore && (
              <button className="button button--ghost" type="button" onClick={() => setLimit((value) => value + 20)}>
                Load older entries
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
