import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import gsap from 'gsap';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveal a page in one pass on the shared GSAP ticker. Every effect is reverted when the
 * route changes so a new page never inherits an old timeline.
 */
export function usePageMotion(): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    if (prefersReducedMotion()) {
      gsap.set(root, { clearProps: 'all' });
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(root, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out' });
      const targets = root.querySelectorAll('[data-reveal]');
      if (targets.length > 0) {
        gsap.fromTo(
          targets,
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, ease: 'power2.out', stagger: 0.045, delay: 0.08 },
        );
      }
    }, root);

    return () => context.revert();
  }, [location.pathname]);

  return ref;
}
