'use client';

import { useEffect, type RefObject } from 'react';

/** Pointer updates stay outside React; each surface remains a normal keyboard target. */
export function useAirspaceDepth(
  root: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const surfaces = [...element.querySelectorAll<HTMLElement>('[data-depth]')];
    const reset = () => {
      element.style.setProperty('--look-x', '0');
      element.style.setProperty('--look-y', '0');
      surfaces.forEach((surface) => {
        surface.style.setProperty('--tilt-x', '0deg');
        surface.style.setProperty('--tilt-y', '0deg');
        surface.style.setProperty('--glare-x', '50%');
        surface.style.setProperty('--glare-y', '30%');
      });
    };
    reset();
    const revealTargets = [
      ...element.querySelectorAll<HTMLElement>('[data-reveal]'),
    ];
    if (!enabled) {
      revealTargets.forEach((target) =>
        target.classList.remove('awaiting-reveal'),
      );
      return;
    }
    const fine = window.matchMedia('(pointer: fine)');
    let frame = 0;
    let lastSurface: HTMLElement | null = null;
    const onMove = (event: PointerEvent) => {
      if (!fine.matches || event.pointerType !== 'mouse') return;
      const target = event.target instanceof Element ? event.target : null;
      const surface = target?.closest<HTMLElement>('[data-depth]') ?? null;
      const sky = target?.closest<HTMLElement>('.sky-section') ?? null;
      const x = event.clientX,
        y = event.clientY;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (sky) {
          const r = sky.getBoundingClientRect();
          element.style.setProperty(
            '--look-x',
            String(((x - r.left) / r.width) * 2 - 1),
          );
          element.style.setProperty(
            '--look-y',
            String(((y - r.top) / r.height) * 2 - 1),
          );
        } else {
          element.style.setProperty('--look-x', '0');
          element.style.setProperty('--look-y', '0');
        }
        if (lastSurface && lastSurface !== surface) {
          lastSurface.style.setProperty('--tilt-x', '0deg');
          lastSurface.style.setProperty('--tilt-y', '0deg');
        }
        if (surface) {
          const r = surface.getBoundingClientRect();
          const px = Math.max(0, Math.min(1, (x - r.left) / r.width)),
            py = Math.max(0, Math.min(1, (y - r.top) / r.height));
          const strength = surface.dataset.depth === 'ticket' ? 6 : 2;
          surface.style.setProperty('--tilt-x', `${(0.5 - py) * strength}deg`);
          surface.style.setProperty('--tilt-y', `${(px - 0.5) * strength}deg`);
          surface.style.setProperty('--glare-x', `${px * 100}%`);
          surface.style.setProperty('--glare-y', `${py * 100}%`);
        }
        lastSurface = surface;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      reset();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove('awaiting-reveal');
            entry.target.classList.add('depth-revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px 45px 0px' },
    );
    revealTargets.forEach((target) => {
      if (target.getBoundingClientRect().top > window.innerHeight * 0.98)
        target.classList.add('awaiting-reveal');
      observer.observe(target);
    });
    element.addEventListener('pointermove', onMove, { passive: true });
    element.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      revealTargets.forEach((target) =>
        target.classList.remove('awaiting-reveal'),
      );
      reset();
    };
  }, [enabled, root]);
}
