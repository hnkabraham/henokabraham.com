// The live watch faces: every face draws through a whole day awake and
// always-on in both clock habits, none ever shows an authenticator code
// (Nightwatch's 2FA row stays off, as it ships), each shows the time the
// watch would, always-on drifts within the face's own grid, and every still,
// font and notice the showcase names is there.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const moduleURL = async (file, replacements = {}) => {
  let js = transpileModule(
    await fs.readFile(new URL(file, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2022,
      },
    },
  ).outputText;
  for (const [name, value] of Object.entries(replacements))
    js = js.replaceAll(`from '${name}'`, `from '${value}'`);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
};
const dcURL = await moduleURL('../lib/watch-face-dc.ts');
const faceIds = ['nightwatch', 'arcfield', 'meridian'];
const faceURLs = {};
for (const id of faceIds)
  faceURLs[`./watch-face-${id}`] = await moduleURL(
    `../lib/watch-face-${id}.ts`,
    { './watch-face-dc': dcURL },
  );
const { drawFace } = await import(
  await moduleURL('../lib/watch-faces.ts', {
    './watch-face-dc': dcURL,
    ...faceURLs,
  })
);
const { watchFaces, bezelFaces } = await import(
  await moduleURL('../app/watch-face-data.ts')
);

// A canvas that records the text drawn and accepts every other call. Text
// is measured at half its size a character, enough for the faces' fitting
// rules to run.
globalThis.Path2D = class {};
function recorder() {
  const texts = [];
  const ctx = {
    font: '10px x',
    texts,
    measureText: (value) => ({
      width: value.length * 0.55 * Number.parseFloat(ctx.font),
    }),
    fillText: (value, x, y) => texts.push({ value, x, y }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(ctx, {
    get: (target, name) => (name in target ? target[name] : () => {}),
  });
}
const frame = (date, is24Hour) => ({
  hour: date.getUTCHours(),
  min: date.getUTCMinutes(),
  sec: date.getUTCSeconds(),
  epoch: Math.floor(date.getTime() / 1000),
  day: date.getUTCDate(),
  weekday: date.getUTCDay(),
  month: date.getUTCMonth(),
  is24Hour,
});
const drawn = (id, date, { is24Hour = false, alwaysOn = false } = {}) => {
  const ctx = recorder();
  drawFace(ctx, id, frame(date, is24Hour), alwaysOn);
  // Figures are set one cell at a time; join each run back into its line.
  const lines = [];
  for (const text of ctx.texts) {
    const last = lines.at(-1);
    if (last?.run && text.value.length === 1 && text.y === last.y)
      last.value += text.value;
    else lines.push({ ...text, run: text.value.length === 1 });
  }
  return lines;
};
const shows = (texts, value) => texts.some((text) => text.value === value);

// Every minute of a day, both habits, both modes: nothing throws, both
// screens carry text, and no screen shows a code.
const day = Date.UTC(2026, 9, 2);
const at = (hour, min) => new Date(day + hour * 3_600_000 + min * 60_000);
for (const id of faceIds)
  for (let minute = 0; minute < 1440; minute++)
    for (const is24Hour of [false, true]) {
      const date = new Date(day + minute * 60_000 + 33_000);
      for (const alwaysOn of [false, true]) {
        const texts = drawn(id, date, { is24Hour, alwaysOn });
        assert.ok(texts.length, `${id} draws text`);
        assert.ok(
          !texts.some((text) => /\d{3} \d{3}|2FA/.test(text.value)),
          `${id} never shows a code`,
        );
      }
    }

// Over nine minutes the always-on screen visits each place in its 3 x 3
// grid once, two pixels apart, as each face's own view moves it.
for (const id of faceIds) {
  const places = new Set();
  const xs = new Set();
  const ys = new Set();
  for (let step = 0; step < 9; step++) {
    const texts = drawn(id, new Date(day + step * 60_000), { alwaysOn: true });
    const line = texts.find((text) => text.value.startsWith('FRI'));
    assert.ok(line, `${id} shows the weekday always-on`);
    places.add(`${line.x},${line.y}`);
    xs.add(line.x);
    ys.add(line.y);
  }
  const spread = (values) => Math.max(...values) - Math.min(...values);
  assert.equal(places.size, 9, `${id} always-on visits nine places`);
  assert.equal(spread(xs), 4, `${id} drifts two pixels each way across`);
  assert.equal(spread(ys), 4, `${id} drifts two pixels each way down`);
}

// The clock each digital readout would show.
assert.ok(shows(drawn('nightwatch', at(0, 10)), '12:10'), 'midnight is 12:10');
assert.ok(
  shows(drawn('nightwatch', at(9, 5)), '09:05'),
  'hours keep their zero',
);
assert.ok(shows(drawn('nightwatch', at(21, 47), { is24Hour: true }), '21:47'));
assert.ok(shows(drawn('nightwatch', at(21, 47), { alwaysOn: true }), '09:47'));
assert.ok(
  shows(drawn('meridian', at(9, 5)), '9:05') &&
    !shows(drawn('meridian', at(9, 5)), '09:05'),
  'Meridian drops the zero on a 12-hour watch',
);
assert.ok(shows(drawn('meridian', at(21, 47), { is24Hour: true }), '21:47'));
assert.ok(shows(drawn('meridian', at(21, 47), { alwaysOn: true }), '9:47'));
for (const id of faceIds)
  assert.ok(
    drawn(id, at(10, 12)).some((text) => /\bFRI\b/.test(text.value)),
    `${id} names the weekday`,
  );

// The data, stills, fonts and notices the section names.
assert.deepEqual(
  watchFaces.map((face) => face.id),
  faceIds,
  'the showcase lists the three ported faces',
);
assert.equal(bezelFaces.count, 20, 'the board still counts Bezel Auth');
for (const face of watchFaces) {
  if (face.url)
    assert.match(
      face.url,
      /^https:\/\/apps\.garmin\.com\/apps\/[0-9a-f-]{36}$/,
      `${face.name} links its own public listing`,
    );
  for (const format of ['jpg', 'avif']) {
    const still = await fs.readFile(
      new URL(
        `../public/images/watch-faces/${face.id}.${format}`,
        import.meta.url,
      ),
    );
    assert.ok(still.length > 2000, `${face.id}.${format} is a real image`);
  }
}
assert.ok(
  watchFaces.find((face) => face.id === 'nightwatch').url,
  'Nightwatch links its listing',
);
const component = await fs.readFile(
  new URL('../app/watch-showcase.tsx', import.meta.url),
  'utf8',
);
const fonts = [
  ...component.matchAll(/'\/fonts\/(watch-[a-z-]+-[0-9a-f]+\.woff2)'/g),
];
assert.equal(fonts.length, 3, 'the showcase loads its three fonts');
for (const [, font] of fonts)
  assert.ok(
    (await fs.stat(new URL(`../public/fonts/${font}`, import.meta.url))).size >
      4000,
    `${font} is served`,
  );
assert.doesNotMatch(component, /sampleCode|TOTP/, 'no code is generated');
for (const notice of ['Barlow-OFL.txt', 'Roboto-Condensed-OFL.txt'])
  assert.match(
    await fs.readFile(
      new URL(`../public/fonts/${notice}`, import.meta.url),
      'utf8',
    ),
    /SIL Open Font License/,
    `${notice} travels with its font`,
  );
console.log('Watch faces: clocks, always-on, no codes, and assets check out.');
