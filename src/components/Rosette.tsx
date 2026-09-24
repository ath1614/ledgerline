import { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '../lib/motion';

interface RosetteProps {
  /** 0 to 100. Drives ring amplitude and ink weight. */
  score: number;
  size?: number;
}

/**
 * A guilloche rosette: superposed rings whose radius wobbles by a sine term. Engraved
 * patterns on banknotes use the same construction, and here the wobble is the risk score.
 */
function buildPaths(score: number): string[] {
  const intensity = Math.min(1, Math.max(0, score / 100));
  const rings = 9 + Math.round(intensity * 7);
  const paths: string[] = [];
  const centre = 200;

  for (let ring = 0; ring < rings; ring += 1) {
    const baseRadius = 42 + ring * (7.2 - intensity * 1.4);
    const lobes = 5 + (ring % 5) * 3;
    const amplitude = 1.2 + intensity * 7 + (ring % 3) * 0.8;
    const phase = ring * 0.42;
    const steps = 240;
    let path = '';

    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const radius = baseRadius + amplitude * Math.sin(lobes * angle + phase);
      const x = centre + radius * Math.cos(angle);
      const y = centre + radius * Math.sin(angle);
      path += `${step === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    paths.push(`${path}Z`);
  }

  return paths;
}

export function Rosette({ score, size = 420 }: RosetteProps) {
  const paths = useMemo(() => buildPaths(score), [score]);
  const group = useRef<SVGGElement>(null);
  const root = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!group.current || prefersReducedMotion()) return;
    const spin = gsap.to(group.current, {
      rotate: 360,
      duration: 240,
      repeat: -1,
      ease: 'none',
      transformOrigin: '50% 50%',
    });
    return () => {
      spin.kill();
    };
  }, []);

  useEffect(() => {
    if (!root.current || prefersReducedMotion()) return;
    const pulse = gsap.fromTo(
      root.current,
      { scale: 0.985 },
      { scale: 1, duration: 0.9, ease: 'power2.out' },
    );
    return () => {
      pulse.kill();
    };
  }, [score]);

  const tone = score >= 85 ? 'var(--signal)' : 'var(--intaglio)';

  return (
    <svg
      ref={root}
      className="rosette"
      viewBox="0 0 400 400"
      width={size}
      height={size}
      role="img"
      aria-label={`Guilloche rosette drawn from a risk score of ${score} out of 100`}
    >
      <g ref={group}>
        {paths.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="none"
            stroke={index % 4 === 0 ? tone : 'var(--ink)'}
            strokeOpacity={index % 4 === 0 ? 0.85 : 0.28}
            strokeWidth={index % 4 === 0 ? 0.9 : 0.5}
          />
        ))}
      </g>
      <circle cx="200" cy="200" r="132" fill="none" stroke="var(--ink)" strokeOpacity="0.22" strokeWidth="0.6" />
      <circle cx="200" cy="200" r="150" fill="none" stroke="var(--ink)" strokeOpacity="0.14" strokeWidth="0.6" />
      <text x="200" y="196" textAnchor="middle" className="rosette__score">
        {score === 0 ? '00' : String(score).padStart(2, '0')}
      </text>
      <text x="200" y="216" textAnchor="middle" className="rosette__label">
        risk index
      </text>
    </svg>
  );
}
