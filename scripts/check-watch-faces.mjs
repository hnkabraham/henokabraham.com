// The live Bezel Auth faces: the sample code is a real RFC 6238 TOTP, every
// face draws through a whole day awake and always-on in both clock habits,
// each shows the time the watch would, always-on never shows a code and
// drifts within the watch's 3 x 3 grid, and every still, font and listing
// the showcase names is there.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';

const moduleURL = async (file, replacements = {}) => {
  let js = transpileModule(
    await fs.readFile(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ModuleKind.ESNext } },
  ).outputText;
  for (const [name, value] of Object.entries(replacements))
    js = js.replaceAll(`from '${name}'`, `from '${value}'`);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
};
const dcURL = await moduleURL('../lib/watch-face-dc.ts');
const faceIds = ['atelier', 'chrono', 'orbit', 'summit', 'tactical', 'words'];
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
const { sampleCode } = await import(
  await moduleURL('../lib/watch-face-totp.ts')
);
const { watchFaces, bezelFaces } = await import(
  await moduleURL('../app/watch-face-data.ts')
);

// RFC 6238's SHA-1 test vectors, cut to the faces' six digits.
for (const [time, code] of [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
])
  assert.equal(await sampleCode(time), code, `TOTP at ${time}`);
// The store images' Atelier code, captured at 00:10:33 PDT on 2 October 2026.
assert.equal(
  await sampleCode(Date.UTC(2026, 9, 2, 7, 10, 33) / 1000),
  '308849',
);

// A canvas that records what is drawn. Text is measured at half its size a
// character, enough for the faces' fitting rules to run.
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
  };
  for (const name of [
    'fillRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'arc',
    'arcTo',
    'closePath',
    'stroke',
    'fill',
    'save',
    'restore',
    'translate',
    'scale',
    'drawImage',
  ])
    ctx[name] = () => {};
  return ctx;
}
const frame = (date, is24Hour, code = '308849') => ({
  hour: date.getUTCHours(),
  min: date.getUTCMinutes(),
  sec: date.getUTCSeconds(),
  epoch: Math.floor(date.getTime() / 1000),
  day: date.getUTCDate(),
  weekday: date.getUTCDay(),
  month: date.getUTCMonth(),
  is24Hour,
  code,
});
const drawn = (id, date, { is24Hour = false, alwaysOn = false, code } = {}) => {
  const ctx = recorder();
  drawFace(ctx, id, frame(date, is24Hour, code), alwaysOn, { mountain: {} });
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

// Every minute of a day, both habits, both modes: nothing throws, the
// always-on screen never carries the code, and it only ever drifts by up to
// three pixels either way.
const day = Date.UTC(2026, 9, 2);
const at = (hour, min) => new Date(day + hour * 3_600_000 + min * 60_000);
for (const id of faceIds)
  for (let minute = 0; minute < 1440; minute++)
    for (const is24Hour of [false, true]) {
      const date = new Date(day + minute * 60_000 + 33_000);
      const awake = drawn(id, date, { is24Hour });
      assert.ok(awake.length, `${id} draws text awake`);
      const standby = drawn(id, date, { is24Hour, alwaysOn: true });
      assert.ok(
        !standby.some((text) => /308/.test(text.value)),
        `${id} keeps the code off the always-on screen`,
      );
    }
for (const id of faceIds) {
  const date = new Date(day + 10 * 60_000);
  const texts = drawn(id, date, { code: null });
  assert.ok(
    !texts.some((text) => /\d{3} \d{3}/.test(text.value)),
    `${id} shows no code when there is none`,
  );
  assert.ok(
    shows(drawn(id, date), '308 849'),
    `${id} shows the code awake, split in threes`,
  );
}
// Over nine minutes the always-on screen visits each place in its 3 x 3
// grid once, three pixels apart.
const places = new Set();
const xs = new Set();
const ys = new Set();
for (let step = 0; step < 9; step++) {
  const line = drawn('words', new Date(day + step * 60_000), {
    alwaysOn: true,
  }).find((text) => text.value === '8,420 / 64%');
  places.add(`${line.x},${line.y}`);
  xs.add(line.x);
  ys.add(line.y);
}
assert.equal(places.size, 9, 'always-on visits nine places');
const spread = (values) => Math.max(...values) - Math.min(...values);
assert.equal(spread(xs), 6, 'always-on drifts three pixels each way across');
assert.equal(spread(ys), 6, 'always-on drifts three pixels each way down');
assert.ok(
  shows(drawn('words', at(21, 47), { alwaysOn: true }), '09:47'),
  'Words shows the time in figures always-on',
);

// The clock each face would show.
assert.ok(shows(drawn('tactical', at(0, 10)), '12:10'), 'midnight is 12:10');
assert.ok(shows(drawn('tactical', at(0, 10)), 'FRI / OCT 02'));
assert.ok(shows(drawn('tactical', at(9, 5)), '09:05'), 'hours keep their zero');
assert.ok(shows(drawn('tactical', at(21, 47), { is24Hour: true }), '21:47'));
assert.ok(shows(drawn('orbit', at(9, 5)), '09:05'));
assert.ok(
  shows(drawn('summit', at(9, 5)), '9:05') &&
    !shows(drawn('summit', at(9, 5)), '09:05'),
  'Summit drops the zero on a 12-hour watch',
);
assert.ok(shows(drawn('summit', at(9, 5)), 'AM'));
assert.ok(shows(drawn('summit', at(21, 47)), 'PM'));
assert.ok(
  shows(drawn('summit', at(21, 47), { is24Hour: true }), '21:47'),
  'Summit keeps two figures on a 24-hour watch',
);
assert.ok(
  shows(drawn('summit', at(21, 47), { is24Hour: true }), 'OCT'),
  'Summit names the month where a 12-hour watch says AM or PM',
);
for (const [hour, min, lines] of [
  [0, 12, ['TEN PAST', 'TWELVE']],
  [21, 47, ['QUARTER TO', 'TEN']],
  [23, 58, ['TWELVE', "O'CLOCK"]],
  [6, 33, ['TWENTY FIVE', 'TO SEVEN']],
  [6, 30, ['HALF PAST', 'SIX']],
]) {
  const texts = drawn('words', at(hour, min));
  for (const line of lines)
    assert.ok(
      shows(texts, line),
      `Words at ${String(hour)}:${String(min)} says ${line}`,
    );
}

// The data, stills, fonts and listings the section names.
assert.deepEqual(
  watchFaces.map((face) => face.id).sort(),
  [...faceIds].sort(),
  'the showcase lists the six ported faces',
);
assert.equal(bezelFaces.count, 20);
assert.equal(bezelFaces.inWords, 'twenty');
for (const face of watchFaces) {
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
const ridge = await fs.stat(
  new URL('../public/images/watch-faces/summit-ridge.webp', import.meta.url),
);
assert.ok(ridge.size > 2000, 'Summit has its ridge');
const component = await fs.readFile(
  new URL('../app/watch-showcase.tsx', import.meta.url),
  'utf8',
);
for (const [, font] of component.matchAll(
  /'\/fonts\/(watch-[a-z]+-[0-9a-f]+\.woff2)'/g,
))
  assert.ok(
    (await fs.stat(new URL(`../public/fonts/${font}`, import.meta.url))).size >
      4000,
    `${font} is served`,
  );
assert.equal(
  [...component.matchAll(/'\/fonts\/watch-/g)].length,
  2,
  'the showcase loads its two fonts',
);
for (const notice of ['Barlow-OFL.txt', 'Roboto-Condensed-OFL.txt'])
  assert.match(
    await fs.readFile(
      new URL(`../public/fonts/${notice}`, import.meta.url),
      'utf8',
    ),
    /SIL Open Font License/,
    `${notice} travels with its font`,
  );
console.log('Watch faces: codes, clocks, always-on and assets check out.');
