import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { transpileModule, ModuleKind, JsxEmit, ScriptTarget } from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const uri = (text) =>
  `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const compile = async (path) =>
  transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2022,
      jsx: JsxEmit.ReactJSX,
    },
  }).outputText;
const atlas = uri(await compile('../app/flight-atlas.ts'));
const geometry = uri(await compile('../lib/personal-flight-log.ts'));
const helpers = uri(await compile('../lib/flight-atlas.ts'));
const { flightAtlas } = await import(atlas);
const { personalFlights } = await import(
  uri(await compile('./data/personal-flights.ts'))
);
const { flightLogStats } = await import(geometry);
for (const [year, period] of Object.entries(flightAtlas.periods)) {
  const flights = personalFlights.filter(
    (f) => year === 'all' || f.date.startsWith(year),
  );
  assert.deepEqual(
    period.stats,
    flightLogStats(flights),
    `${year} retains its exact aggregate totals`,
  );
  assert.deepEqual(
    new Set(period.airportCodes),
    new Set(flights.flatMap((f) => [f.from.code, f.to.code])),
  );
  assert.deepEqual(
    new Set(period.routes.map((route) => route.join(':'))),
    new Set(flights.map((f) => `${f.from.code}:${f.to.code}`)),
  );
  assert.deepEqual(Object.keys(period).sort(), [
    'airportCodes',
    'routes',
    'stats',
  ]);
}
const serialized = JSON.stringify(flightAtlas);
assert.ok(
  !/flightNumber|aircraft|airline|scheduledTo|flight-|\d{4}-\d{2}-\d{2}/.test(
    serialized,
  ),
  'Published data has no exact flights',
);
const imports = {
  react: import.meta.resolve('react'),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'lucide-react': import.meta.resolve('lucide-react'),
  './flight-atlas': atlas,
  '@/lib/personal-flight-log': geometry,
  '@/lib/flight-atlas': helpers,
};
let code = await compile('../app/aviation-logbook.tsx');
for (const [from, to] of Object.entries(imports))
  code = code
    .replaceAll(`from '${from}'`, `from '${to}'`)
    .replaceAll(`from "${from}"`, `from "${to}"`);
const { default: View } = await import(uri(code));
const html = renderToStaticMarkup(createElement(View));
const count = (pattern) => (html.match(pattern) ?? []).length;
assert.equal(count(/<option /g), flightAtlas.years.length + 1);
assert.equal(
  count(/class="logbook-route"/g),
  flightAtlas.periods.all.routes.length,
);
assert.equal(
  count(/class="logbook-country"/g),
  flightAtlas.periods.all.stats.countries,
);
const international = Object.values(flightAtlas.airports).filter(
  (a) => a.country !== 'US',
);
assert.equal(count(/class="logbook-destination"/g), international.length);
for (const airport of international) {
  assert.ok(
    html.includes(`href="/images/flags/${airport.country.toLowerCase()}.svg"`),
  );
  assert.ok(html.includes(`>${airport.code}</text>`));
}
assert.ok(
  !/logbook-flight-list|logbook-pass-route|logbook-pagination|<time |Flight history pages|NaN|Infinity/.test(
    html,
  ),
);
for (const flight of personalFlights)
  assert.ok(!html.includes(flight.id) && !html.includes(flight.date));
for (const country of new Set(
  Object.values(flightAtlas.airports).map((a) => a.country),
)) {
  const svg = await readFile(
    new URL(
      `../public/images/flags/${country.toLowerCase()}.svg`,
      import.meta.url,
    ),
    'utf8',
  );
  assert.ok(svg.includes('<svg'));
  assert.ok(!/<script|<foreignObject|onload=/.test(svg));
}
// The component emits international callouts with leader lines. Catch collisions
// in the densest all-time view without a browser or screenshot dependency.
const positions = [
  ...html.matchAll(
    /class="logbook-destination"><title>.*?<\/title><path[^>]*><\/path><g transform="translate\(([^,]+),([^\)]+)\)"/g,
  ),
].map((m) => [+m[1], +m[2]]);
assert.equal(positions.length, international.length);
for (let i = 0; i < positions.length; i++)
  for (let j = i + 1; j < positions.length; j++) {
    const [x, y] = positions[i],
      [a, b] = positions[j];
    assert.ok(
      Math.abs(x - a) >= 70 || Math.abs(y - b) >= 28,
      `Destination labels ${i} and ${j} must not overlap`,
    );
  }
if (process.argv.includes('--built')) {
  let checked = 0;
  async function scan(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), root);
      if (entry.isDirectory()) await scan(path);
      else if (/\.(js|json|map|html)$/.test(entry.name)) {
        const contents = await readFile(path, 'utf8');
        for (const flight of personalFlights)
          assert.ok(
            !contents.includes(flight.id),
            `Individual flight found in ${path.pathname}`,
          );
        assert.ok(
          !contents.includes('flightNumber:'),
          `Flight detail fields found in ${path.pathname}`,
        );
        checked++;
      }
    }
  }
  await scan(new URL('../dist/client/', import.meta.url));
  assert.ok(checked > 0);
  console.log(
    `Built privacy check: ${checked} public files contain no individual flight IDs.`,
  );
}
console.log(
  `Passed: 12 reconciled summary periods, ${flightAtlas.periods.all.stats.countries} country flags, ${international.length} international map labels, no flight details. Rendered log: ${Buffer.byteLength(html).toLocaleString()} bytes.`,
);
