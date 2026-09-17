import type { AnomaliesResponse } from '../core/api';
import { RiskChip } from '../components/Chip';
import { money, when } from '../lib/format';
import { usePageMotion } from '../lib/motion';
import { useApi } from '../lib/useApi';
import { CODE_LABEL } from './Overview';

const RULE_NOTE: Record<string, string> = {
  card_testing: 'Five or more charges under 50.00 from one merchant inside ten minutes usually means stolen numbers are being tested.',
  velocity_spike: 'Eight or more charges in ten minutes, at least four times the merchant baseline for the whole window.',
  amount_outlier: 'A charge more than 3.5 robust deviations above the merchant median, and at least three times its size.',
  refund_burst: 'Three or more refunds in five minutes making up at least 40 percent of recent movements.',
  duplicate_amount: 'Three charges of exactly the same amount inside fifteen minutes, the signature of a retried checkout.',
};

export function Risk() {
  const pageRef = usePageMotion();
  const { data, error, loading } = useApi<AnomaliesResponse>('/api/anomalies');

  const groups = new Map<string, number>();
  for (const finding of data?.anomalies ?? []) {
    groups.set(finding.code, (groups.get(finding.code) ?? 0) + 1);
  }

  return (
    <div className="page page--inner" ref={pageRef}>
      <header className="page-head">
        <p className="kicker" data-reveal>
          Risk · rule based, explainable
        </p>
        <h1 className="display display--inner" data-reveal>
          A score you can argue with.
        </h1>
        <p className="page-head__lede" data-reveal>
          There is no model here to hide behind. Five rules read the stream in order, each one reports the numbers that
          fired it, and the score is the weight of the rule that fired. A reviewer can dismiss a finding by disagreeing
          with the evidence.
        </p>
      </header>

      <section className="folio risk-layout">
        <aside className="risk-index" aria-label="Findings by rule">
          <p className="kicker">Findings by rule</p>
          <ul>
            {Object.entries(CODE_LABEL).map(([code, label]) => (
              <li key={code}>
                <span>{label}</span>
                <span className="mono">{groups.get(code) ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className="table-foot">
            {data?.anomalies.length ?? 0} findings across {new Set((data?.anomalies ?? []).map((a) => a.eventId)).size}{' '}
            events.
          </p>
        </aside>

        <div className="risk-list">
          {error && <p className="empty">Findings could not load: {error}</p>}
          {loading && <div className="finding finding--ghost" />}

          {data?.anomalies.map((finding, index) => (
            <article className="finding" key={`${finding.eventId}-${finding.code}`} data-reveal>
              <div className="finding__score">
                <span className="finding__value">{finding.score}</span>
                <span className={`rail rail--${finding.severity}`} aria-hidden="true">
                  <span style={{ height: `${finding.score}%` }} />
                </span>
              </div>
              <div className="finding__body">
                <div className="finding__title">
                  <h2>
                    <span className="mono finding__index">{String(index + 1).padStart(2, '0')}</span>
                    {CODE_LABEL[finding.code] ?? finding.code}
                  </h2>
                  <RiskChip score={finding.score} />
                </div>
                <p className="finding__note">{RULE_NOTE[finding.code]}</p>
                <ul className="reasons">
                  {finding.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="finding__meta mono">
                  {finding.merchantName} · {finding.event ? money(finding.event.amount) : '—'} ·{' '}
                  {finding.event ? when(finding.event.occurredAt) : ''} IST · {finding.eventId}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
