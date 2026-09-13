import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
const flights = uri(await compile('../app/personal-flights.ts'));
const geometry = uri(await compile('../lib/personal-flight-log.ts'));
const data = await import(flights);
const imports = {
  react: import.meta.resolve('react'),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'lucide-react': import.meta.resolve('lucide-react'),
  './personal-flights': flights,
  '@/lib/personal-flight-log': geometry,
};
let code = await compile('../app/aviation-logbook.tsx');
for (const [from, to] of Object.entries(imports))
  code = code
    .replaceAll(`from '${from}'`, `from '${to}'`)
    .replaceAll(`from "${from}"`, `from "${to}"`);
const { default: View } = await import(uri(code));
const html = renderToStaticMarkup(createElement(View));
const count = (pattern) => (html.match(pattern) ?? []).length;
assert.equal(
  count(/aria-pressed="(?:true|false)"/g),
  Math.min(20, data.personalFlights.length),
);
assert.equal(
  count(/aria-pressed="true"/g),
  1,
  'One recorded flight is selected initially',
);
const years = new Set(data.personalFlights.map((f) => f.date.slice(0, 4)));
assert.equal(
  count(/<option /g),
  years.size + 1,
  'Every recorded year can be selected',
);
const routes = new Set(
  data.personalFlights.map((f) => `${f.from.code}:${f.to.code}`),
);
assert.equal(
  count(/class="logbook-route /g),
  routes.size,
  'Repeated flights share their map arc',
);
assert.ok(!html.includes('Routes coming soon'));
assert.ok(
  html.includes('Flight history pages'),
  'All remaining flights are accessible through pagination',
);
assert.ok(
  Buffer.byteLength(html) < 220000,
  'Initial flight-log markup remains bounded',
);
assert.ok(html.includes(data.personalFlights[0].flightNumber));
assert.ok(html.includes(data.personalFlights[0].aircraft));
assert.ok(!/NaN|Infinity|Date not recorded/.test(html));
assert.equal(
  data.flightLogImport.sourceRows,
  data.personalFlights.length +
    data.flightLogImport.canceled +
    data.flightLogImport.cutoffExcluded +
    data.flightLogImport.duplicates,
);
assert.equal(
  data.personalFlights.filter((f) => f.scheduledTo).length,
  data.flightLogImport.diversions,
);
console.log(
  `Passed: ${Math.min(20, data.personalFlights.length)} visible flight controls, ${years.size} years, ${routes.size} route arcs, default boarding pass and complete source-row reconciliation. Rendered log: ${Buffer.byteLength(html).toLocaleString()} bytes.`,
);
