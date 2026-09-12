import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
const source = await readFile(
  new URL('../lib/bay-performance.ts', import.meta.url),
  'utf8',
);
const js = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext },
}).outputText;
const {
  createFlightPerformance,
  createScrollPerformance,
  flightPixelRatio,
  followFlightProgress,
  summarizeFlightFrames,
} = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

// Exercise a fast opening followed by expensive scenery, then recovery.
const control = createFlightPerformance();
let now = 1000;
const run = (duration, fps) => {
  const end = now + duration;
  let changes = 0;
  while (now < end) {
    now += 1000 / fps;
    if (control.sample(now)?.changed) changes++;
  }
  return changes;
};
assert.equal(control.quality, 1);
run(5000, 60);
assert.equal(
  control.quality,
  1,
  'A fast opening cannot prematurely enable high detail',
);
run(4000, 30);
assert.equal(
  control.quality,
  0,
  'Quality falls when late scenery slows the flight',
);
run(12000, 60);
assert.equal(control.quality, 0, 'Recovery waits for sustained headroom');
run(15000, 60);
assert.equal(
  control.quality,
  1,
  'Sustained smooth rendering can restore detail',
);
control.reset();
now += 600000;
run(5000, 60);
assert.equal(control.quality, 1, 'A background-tab gap is not a slow frame');
assert.equal(run(10000, 54), 0, 'The target band does not oscillate');
run(30000, 120);
assert.equal(control.quality, 2);
run(20000, 20);
assert.equal(control.quality, 0);
assert.equal(run(10000, 20), 0, 'Quality remains bounded');
const isolated = createFlightPerformance();
for (let t = 1000; t < 5000; t += 1000 / 60) isolated.sample(t);
isolated.sample(5150);
for (let t = 5167; t < 7000; t += 1000 / 60) isolated.sample(t);
assert.equal(
  isolated.quality,
  1,
  'One upload hitch does not cause a downgrade',
);

for (const [width, height, dpr, mobile] of [
  [390, 844, 3, true],
  [844, 390, 3, true],
  [1920, 1080, 2, false],
  [3840, 2160, 2, false],
]) {
  let previous = 0;
  for (const quality of [0, 1, 2]) {
    const ratio = flightPixelRatio(width, height, dpr, mobile, quality);
    assert.ok(ratio >= previous && ratio <= dpr);
    assert.ok(width * height * ratio ** 2 <= (mobile ? 1000000 : 2750000) + 1);
    previous = ratio;
  }
}
const advance = (from, to, fps, duration) => {
  let p = from;
  for (let i = 0; i < fps * duration; i++) {
    const next = followFlightProgress(p, to, 1 / fps);
    assert.ok(
      next >= Math.min(from, to) && next <= Math.max(from, to),
      'No overshoot',
    );
    p = next;
  }
  return p;
};
for (const fps of [30, 60, 120]) {
  assert.ok(
    advance(0, 1, fps, 1.6) > 0.999,
    'Full-route catch-up within 1.6 seconds',
  );
  assert.ok(
    advance(1, 0, fps, 1.6) < 0.001,
    'Reverse scroll is equally responsive',
  );
  assert.ok(
    Math.abs(advance(0.4, 0.45, fps, 0.35) - 0.45) < 0.001,
    'Small scroll settles promptly',
  );
}
assert.ok(
  followFlightProgress(0, 1, 30) <= 0.040001,
  'A resumed tab cannot teleport',
);
const stats = summarizeFlightFrames([
  ...Array(90).fill(1000 / 60),
  ...Array(10).fill(50),
]);
assert.ok(Math.abs(stats.fps - 50) < 0.000001);
assert.equal(stats.p95, 50);
assert.equal(stats.jank, 10);
const scroll = createScrollPerformance();
let t = 1000;
let reports = 0;
for (let i = 0; i < 600; i++) {
  t += 1000 / 60;
  assert.equal(scroll.sample(t, 0, false), undefined);
}
for (const progress of [0.1, 0.5, 0.9]) {
  for (let i = 0; i < 250; i++) {
    t += 1000 / 60;
    if (scroll.sample(t, progress, true)) reports++;
  }
  scroll.reset();
  t += 60000;
}
assert.equal(reports, 3, 'Scrolling telemetry covers three regions, once each');
assert.equal(
  scroll.sample(t + 16, 0.5, true),
  undefined,
  'Revisits cannot spam telemetry',
);
console.log(
  'Passed: late-load adaptation, bounded quality and pixel budgets, slow recovery, no background penalties, bidirectional scroll response at 30/60/120 Hz, and moving-frame telemetry.',
);
