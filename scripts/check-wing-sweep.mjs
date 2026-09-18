import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
const moduleURL = async (file, replacements = {}) => {
  let js = transpileModule(
    await fs.readFile(new URL(file, import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ModuleKind.ESNext },
    },
  ).outputText;
  for (const [key, value] of Object.entries(replacements))
    js = js.replaceAll(`from '${key}'`, `from '${value}'`);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
};
const tour = await moduleURL('../lib/dreamliner-tour.ts');
const cut = await moduleURL('../lib/dreamliner-cut.ts', {
  './dreamliner-engine': await moduleURL('../lib/dreamliner-engine.ts'),
});
const { createWingSweep, createTailSweep } = await import(
  await moduleURL('../lib/wing-sweep.ts', {
    three: import.meta.resolve('three'),
    './dreamliner-tour': tour,
    './dreamliner-cut': cut,
  })
);
const { tourPhase, TOUR_CHAPTERS } = await import(tour);
const { tourScrollLayout, tourProgressAt, tourScrollAt } = await import(
  await moduleURL('../lib/tour-scroll.ts')
);
for (const [width, height, captionBottom] of [
  [1589, 952, 0.57],
  [1920, 1080, 0.56],
  [390, 844, 0.48],
  [375, 667, 0.58],
  [844, 390, 0.62],
  [781, 914, 0.5],
]) {
  const sample = createWingSweep(width, height);
  assert.ok(
    sample(0.025).every((y) => y < 0),
    'The sky opening shows all text',
  );
  let prior = sample(0).slice();
  for (let p = 0; p <= 0.3401; p += 0.001) {
    const front = sample(p);
    assert.ok(
      front.every((y, i) => Number.isFinite(y) && y >= prior[i]),
      'Erased text never reappears during forward scrolling',
    );
    prior = front.slice();
  }
  const completed = sample(0.32).slice();
  const right = width <= 800 ? 0.95 : 0.5;
  const caption = [...completed].filter(
    (_, i) =>
      i / (completed.length - 1) >= 0.07 && i / (completed.length - 1) <= right,
  );
  assert.ok(
    Math.min(...caption) > captionBottom,
    `${width}x${height}: wing must erase the subtitle and scroll hint too (${Math.min(...caption).toFixed(3)} > ${captionBottom})`,
  );
  const middle = sample(0.16).slice();
  sample(1); // Jump to the end, then scrub back. No frame-history dependency.
  assert.deepEqual(sample(0.16), middle);
  assert.deepEqual(sample(0.32), completed);
  assert.ok(
    sample(0).every((y) => y < 0),
    'Reverse scrolling restores the whole opening',
  );
}
// The tail clears the Apps text and the phone preview before Devices.
// Bounds match the responsive caption: its eyebrow is narrower than the title.
for (const [width, height, top, right] of [
  [1589, 952, 0.23, 0.4],
  [1920, 1080, 0.23, 0.4],
  [390, 844, 0.13, 0.7],
  [375, 667, 0.13, 0.7],
  [844, 390, 64 / 390, 0.36],
  [781, 914, 0.13, 0.4],
]) {
  const sample = createTailSweep(width, height);
  assert.ok(
    sample(0.34).every((y) => y === 2),
    'Apps starts without a tail cut',
  );
  let prior = sample(0.34).slice();
  for (let p = 0.34; p <= 0.4901; p += 0.001) {
    const front = sample(p);
    assert.ok(
      front.every((y, i) => Number.isFinite(y) && y <= prior[i]),
      'Tail-erased content never comes back while scrolling forward',
    );
    prior = front.slice();
  }
  const cleared = sample(0.48).slice();
  const caption = [...cleared].filter(
    (_, i) => i / 48 >= 0.0625 && i / 48 <= right,
  );
  assert.ok(
    Math.max(...caption) < top,
    `${width}x${height}: tail must clear the whole caption (${Math.max(...caption).toFixed(3)} < ${top})`,
  );
  const middle = sample(0.4).slice();
  sample(1);
  assert.deepEqual(
    sample(0.4),
    middle,
    'Tail reverse has no frame-history dependency',
  );
  assert.deepEqual(sample(0.48), cleared);
  assert.ok(
    sample(0.34).every((y) => y === 2),
    'Reverse restores all Apps content',
  );
}

// Extra scroll distance belongs only to Apps: hold the complete live preview,
// then run the same aircraft/wipe through a longer physical scroll segment.
for (const [width, height, viewport] of [
  [1589, 952, 952],
  [390, 844, 844],
  [375, 667, 667],
  [844, 390, 390],
  [390, 744, 844], // Safari with expanded content area but the same small viewport units.
]) {
  const mobile = width <= 800,
    read = mobile ? 110 : 50,
    extra = mobile ? 70 : 30;
  const layout = tourScrollLayout(
    ((420 + read + extra) * height) / 100,
    viewport,
    read,
    extra,
  );
  const base = 4.2 * height - viewport;
  const close = (a, b, reason) => assert.ok(Math.abs(a - b) < 1e-9, reason);
  close(
    layout.base,
    base,
    'Additional Apps distance does not alter the opening speed',
  );
  const tail = createTailSweep(width, viewport);
  for (const p of [0, 0.025, 0.1, 0.2, 0.3, 0.33])
    close(
      tourProgressAt(p * base, layout),
      p,
      'Original wing sweep uses the same scroll pixels',
    );
  for (const fraction of [0.01, 0.25, 0.5, 0.9, 0.99]) {
    const p = tourProgressAt(0.34 * base + fraction * layout.hold, layout);
    assert.equal(tourPhase(p), 'roll');
    assert.ok(
      tail(p).every((y) => y === 2),
      'The whole preview remains unclipped throughout the reading hold',
    );
  }
  const wipeDistance = 0.15 * base + layout.sweep;
  assert.ok(
    wipeDistance / (0.15 * base) >= (mobile ? 2.4 : 1.6),
    'The tail crossing itself is slower',
  );
  let prior = -1;
  for (let offset = 0; offset <= layout.travel; offset += 3) {
    const p = tourProgressAt(offset, layout);
    assert.ok(Number.isFinite(p) && p >= prior && p >= 0 && p <= 1);
    prior = p;
  }
  for (const { at, phase } of TOUR_CHAPTERS) {
    const offset = tourScrollAt(at, layout);
    close(
      tourProgressAt(offset, layout),
      at,
      'Chapter buttons and old links use the inverse pacing map',
    );
    assert.equal(tourPhase(tourProgressAt(offset, layout)), phase);
  }
  for (const p of [0.335, 0.34, 0.35, 0.4, 0.48, 0.49, 0.59, 0.78, 1]) {
    const offset = tourScrollAt(p, layout);
    tourProgressAt(layout.travel, layout);
    close(
      tourProgressAt(offset, layout),
      p,
      'Jumping back restores the same flight position',
    );
  }
  for (const boundary of [
    0.34 * base,
    0.34 * base + layout.hold,
    0.49 * base + layout.hold + layout.sweep,
  ])
    assert.ok(
      Math.abs(
        tourProgressAt(boundary + 0.001, layout) -
          tourProgressAt(boundary - 0.001, layout),
      ) < 0.00001,
      'The hold and slower sweep have continuous boundaries',
    );
  assert.equal(tourProgressAt(-100, layout), 0);
  assert.equal(tourProgressAt(layout.travel + 100, layout), 1);
}

assert.equal(
  tourPhase(0.2),
  'preflight',
  'No Apps caption during the wing crossing',
);
assert.equal(
  tourPhase(0.33),
  'preflight',
  'The completed wipe gets a moment of open sky',
);
assert.equal(
  tourPhase(0.37),
  'roll',
  'The Apps chapter button still reaches Apps',
);

// The DOM adapter clips every caption child, reuses measurements at rest,
// and removes its inline styles on detach (including a renderer failure).
const { createOpeningWipe } = await import(
  await moduleURL('../lib/opening-wipe.ts')
);
let measurements = 0;
const nodes = Array.from({ length: 4 }, (_, i) => ({
  style: {
    clipPath: '',
    removeProperty() {
      this.clipPath = '';
    },
  },
  getBoundingClientRect: () => {
    measurements++;
    return { left: 100, top: 160 + i * 80, width: 500, height: 70 };
  },
}));
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
const story = {
  children: nodes,
  offsetParent: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
};
const wipe = createOpeningWipe();
wipe.attach(story);
const front = new Float32Array([0.2, 0.4, 0.6]);
wipe.update(front, 1000, 800);
assert.ok(
  nodes.every((n) => n.style.clipPath.startsWith('polygon(')),
  'All opening copy, including the hint, participates',
);
const first = nodes.map((n) => n.style.clipPath);
assert.equal(measurements, 4);
wipe.update(front, 1000, 800);
assert.equal(measurements, 4, 'No repeated DOM measurements while stationary');
wipe.attach(null);
assert.ok(nodes.every((n) => n.style.clipPath === ''));
wipe.attach(story);
assert.deepEqual(
  nodes.map((n) => n.style.clipPath),
  first,
  'Returning to the intro restores its cut before paint',
);
wipe.dispose();
assert.ok(
  nodes.every((n) => n.style.clipPath === ''),
  'Fallback/disposal leaves no clipped text',
);
// The same DOM adapter closes above the tail, not below the wing. Every
// child takes part, and a remount gets the current cut before its first paint.
const tailWipe = createOpeningWipe('up');
tailWipe.update(front, 1000, 800);
tailWipe.attach(story);
assert.ok(
  nodes.every((n, i) =>
    n.style.clipPath.endsWith(
      `900.0px ${-(160 + i * 80)}px,-100.0px ${-(160 + i * 80)}px)`,
    ),
  ),
);
const tailClips = nodes.map((n) => n.style.clipPath);
tailWipe.attach(null);
tailWipe.attach(story);
assert.deepEqual(
  nodes.map((n) => n.style.clipPath),
  tailClips,
);
tailWipe.dispose();
assert.ok(nodes.every((n) => n.style.clipPath === ''));
console.log(
  'Passed: complete wing and tail wipes on six viewports; forward, reverse and jump consistency; chapter timing; Apps reading hold and slower sweep; chapter/link inverse mapping; Safari viewport units; all caption children; idle measurement caching; cleanup.',
);
