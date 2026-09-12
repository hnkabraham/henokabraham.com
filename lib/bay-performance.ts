/** Bounded quality changes driven by visible frame intervals, not user-agent guesses. */
export type FlightQuality = 0 | 1 | 2;

export function flightPixelRatio(
  width: number,
  height: number,
  dpr: number,
  mobile: boolean,
  quality: FlightQuality,
) {
  const caps = mobile ? [0.9, 1.15, 1.35] : [1, 1.25, 1.5];
  const pixels = mobile
    ? [500_000, 800_000, 1_000_000]
    : [1_000_000, 1_800_000, 2_750_000];
  return Math.min(
    dpr,
    caps[quality],
    Math.sqrt(pixels[quality] / Math.max(1, width * height)),
  );
}

/** A short, frame-rate-independent ease, with a 1.25 s full-route speed limit. */
export function followFlightProgress(
  current: number,
  desired: number,
  dt: number,
) {
  const target = Math.min(1, Math.max(0, desired));
  const seconds = Math.min(0.05, Math.max(0, dt));
  const difference = target - current;
  if (Math.abs(difference) < 0.00001) return target;
  const step = Math.min(
    Math.abs(difference) * (1 - Math.exp(-seconds * 14)),
    seconds * 0.8,
  );
  return current + Math.sign(difference) * step;
}

export function summarizeFlightFrames(frames: number[]) {
  const sorted = [...frames].sort((a, b) => a - b);
  const total = frames.reduce((a, b) => a + b, 0);
  return {
    fps: total ? (frames.length * 1000) / total : 0,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
    // Frames longer than two 60 Hz refresh intervals, with timer tolerance.
    jank: frames.length
      ? (frames.filter((ms) => ms > 34).length * 100) / frames.length
      : 0,
  };
}

export function createFlightPerformance() {
  let quality: FlightQuality = 1;
  let prior = 0;
  let elapsed = 0;
  let healthy = 0;
  let settle = 2000;
  const frames: number[] = [];
  return {
    get quality() {
      return quality;
    },
    // Hidden tabs and reduced motion must not look like GPU stalls.
    reset() {
      prior = 0;
      elapsed = 0;
      frames.length = 0;
      healthy = 0;
      settle = 2000;
    },
    sample(now: number) {
      const ms = prior ? now - prior : 0;
      prior = now;
      if (ms <= 0) return undefined;
      if (settle > 0) {
        settle -= ms;
        return undefined;
      }
      frames.push(ms);
      elapsed += ms;
      if (elapsed < 2000 || frames.length < 10) return undefined;
      const summary = summarizeFlightFrames(frames);
      const slow = summary.fps < 50 || summary.jank > 10;
      healthy = summary.fps >= 57 && summary.p95 < 22 ? healthy + elapsed : 0;
      const previous = quality;
      if (slow && quality > 0) quality = (quality - 1) as FlightQuality;
      // Recovery takes ten healthy windows; reductions need just one.
      else if (healthy >= 20_000 && quality < 2)
        quality = (quality + 1) as FlightQuality;
      if (quality !== previous) {
        healthy = 0;
        settle = 2000;
      }
      elapsed = 0;
      frames.length = 0;
      return { ...summary, quality, changed: quality !== previous };
    },
  };
}

/** One moving-frame sample per departure, climb and Bay/cruise region. */
export function createScrollPerformance() {
  const buckets = Array.from({ length: 3 }, () => ({
    frames: [] as number[],
    elapsed: 0,
    sent: false,
  }));
  let prior = 0;
  return {
    reset() {
      prior = 0;
    },
    sample(now: number, progress: number, moving: boolean) {
      const ms = prior ? now - prior : 0;
      prior = now;
      if (!moving || ms <= 0) return undefined;
      const bucket = buckets[progress < 0.34 ? 0 : progress < 0.7 ? 1 : 2];
      if (bucket.sent) return undefined;
      bucket.frames.push(ms);
      bucket.elapsed += ms;
      if (bucket.elapsed < 2000 || bucket.frames.length < 10) return undefined;
      bucket.sent = true;
      const summary = summarizeFlightFrames(bucket.frames);
      bucket.frames.length = 0;
      return summary;
    },
  };
}
