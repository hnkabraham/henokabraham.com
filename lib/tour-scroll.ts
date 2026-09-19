/**
 * Keep the original flight timing, with extra reading and sweep distance for
 * Apps. The reading zone is not a stop: across the extra hold scroll the
 * flight glides from `slowStart` to `slowEnd` (both from the tuning, by
 * screen shape), so the aircraft keeps moving while the preview is read,
 * and the elevator crossing that follows runs through a longer scroll.
 */
export const APPS_END = 0.49;
const BASE_HEIGHT = 420;

export type TourScroll = {
  height: number;
  viewport: number;
  /** The browser width the pacing was chosen for; a resize re-measures. */
  width: number;
  travel: number;
  base: number;
  hold: number;
  sweep: number;
  slowStart: number;
  slowEnd: number;
};

export function tourScrollLayout(
  height: number,
  viewport: number,
  holdVh: number,
  sweepVh: number,
  pacing: { slowStart: number; slowEnd: number },
  width = 0,
): TourScroll {
  // Derive svh from the actual section height. Safari's innerHeight changes
  // with its bars, so treating innerHeight as 100svh would move the opening.
  const unit = height / (BASE_HEIGHT + holdVh + sweepVh);
  const hold = holdVh * unit,
    sweep = sweepVh * unit;
  const travel = Math.max(1, height - viewport);
  return {
    height,
    viewport,
    width,
    travel,
    hold,
    sweep,
    base: Math.max(1, travel - hold - sweep),
    slowStart: pacing.slowStart,
    slowEnd: pacing.slowEnd,
  };
}

/** The three Apps segments in scroll px: where the glide starts, its length, and the sweep's. */
const segments = (m: TourScroll) => {
  const glideAt = m.slowStart * m.base;
  const glide = (m.slowEnd - m.slowStart) * m.base + m.hold;
  const sweep = (APPS_END - m.slowEnd) * m.base + m.sweep;
  return { glideAt, glide, sweep };
};

/** Scroll pixels -> canonical flight position, shared by aircraft and wipes. */
export function tourProgressAt(offset: number, m: TourScroll) {
  const scroll = Math.max(0, Math.min(m.travel, offset));
  const { glideAt, glide, sweep } = segments(m);
  if (scroll < glideAt) return scroll / m.base;
  if (scroll <= glideAt + glide)
    return (
      m.slowStart +
      (glide > 0 ? (scroll - glideAt) / glide : 0) * (m.slowEnd - m.slowStart)
    );
  const sweepAt = glideAt + glide;
  if (scroll < sweepAt + sweep)
    return m.slowEnd + ((scroll - sweepAt) / sweep) * (APPS_END - m.slowEnd);
  return Math.min(1, (scroll - m.hold - m.sweep) / m.base);
}

/** Chapter links/buttons use the inverse map. A pinned zone lands a quarter in. */
export function tourScrollAt(progress: number, m: TourScroll) {
  const p = Math.max(0, Math.min(1, progress));
  const { glideAt, glide, sweep } = segments(m);
  if (p < m.slowStart) return p * m.base;
  if (p <= m.slowEnd)
    return (
      glideAt +
      (m.slowEnd > m.slowStart
        ? ((p - m.slowStart) / (m.slowEnd - m.slowStart)) * glide
        : glide * 0.25)
    );
  if (p < APPS_END)
    return glideAt + glide + ((p - m.slowEnd) / (APPS_END - m.slowEnd)) * sweep;
  return p * m.base + m.hold + m.sweep;
}
