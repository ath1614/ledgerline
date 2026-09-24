import { riskLabel } from '../lib/format';

export function RiskChip({ score }: { score: number }) {
  const label = riskLabel(score);
  return (
    <span className={`chip chip--${label}`} title={`Risk index ${score} out of 100`}>
      <span className="chip__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
