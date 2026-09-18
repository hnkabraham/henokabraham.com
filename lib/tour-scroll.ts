/** Keep the original flight timing, with extra reading/sweep distance for Apps. */
export const APPS_START = 0.34;
const APPS_END = 0.49;
const BASE_HEIGHT = 420;

export type TourScroll = {
  height: number;
  viewport: number;
  travel: number;
  base: number;
  hold: number;
  sweep: number;
};

export function tourScrollLayout(
  height: number,
  viewport: number,
  holdVh: number,
  sweepVh: number,
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
    travel,
    hold,
    sweep,
    base: Math.max(1, travel - hold - sweep),
  };
}

/** Scroll pixels -> canonical flight position, shared by aircraft and wipes. */
export function tourProgressAt(offset: number, m: TourScroll) {
  const scroll = Math.max(0, Math.min(m.travel, offset));
  const start = APPS_START * m.base;
  if (scroll < start) return scroll / m.base;
  if (scroll <= start + m.hold) return APPS_START;
  const end = APPS_END * m.base + m.hold + m.sweep;
  if (scroll < end)
    return (
      APPS_START +
      ((scroll - start - m.hold) / (end - start - m.hold)) *
        (APPS_END - APPS_START)
    );
  return Math.min(1, (scroll - m.hold - m.sweep) / m.base);
}

/** Chapter links/buttons use the inverse map; Apps lands inside its reading hold. */
export function tourScrollAt(progress: number, m: TourScroll) {
  const p = Math.max(0, Math.min(1, progress));
  if (p < APPS_START) return p * m.base;
  if (p === APPS_START) return p * m.base + m.hold * 0.25;
  if (p < APPS_END)
    return (
      p * m.base +
      m.hold +
      ((p - APPS_START) / (APPS_END - APPS_START)) * m.sweep
    );
  return p * m.base + m.hold + m.sweep;
}
