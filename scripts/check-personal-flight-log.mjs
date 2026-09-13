import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const js = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  );
};
const { routeMiles, routePath, flightLogStats, mapPoint } = await load(
  '../lib/personal-flight-log.ts',
);
const { personalFlights } = await load('../app/personal-flights.ts');
// Synthetic coordinates exercise the geometry; these are never published flights.
const airport = (code, latitude, longitude, country = code) => ({
  code,
  name: code,
  latitude,
  longitude,
  country,
});
const a = airport('AAA', 0, 0, 'A'),
  b = airport('BBB', 0, 90, 'B');
const flight = (id, from = a, to = b) => ({ id, date: null, from, to });
assert.deepEqual(mapPoint(a), [500, 250]);
assert.ok(
  Math.abs(routeMiles(flight('quarter')) - (3958.7613 * Math.PI) / 2) <
    0.000001,
);
assert.equal(routeMiles(flight('same', a, a)), 0);
assert.equal(routePath(flight('same', a, a)), '');
assert.deepEqual(flightLogStats([]), {
  flights: 0,
  airports: 0,
  countries: 0,
  miles: 0,
});
assert.deepEqual(flightLogStats([flight('out'), flight('back', b, a)]), {
  flights: 2,
  airports: 2,
  countries: 2,
  miles: Math.round(3958.7613 * Math.PI),
});
for (const [from, to] of [
  [airport('ONE', 35, 175), airport('TWO', 40, -175)],
  [airport('ONE', 0, 0), airport('TWO', 0, 180)],
  [airport('ONE', 89.9, -50), airport('TWO', 89.9, 150)],
  [a, b],
]) {
  const path = routePath(flight('edge', from, to));
  assert.ok(!/NaN|Infinity/.test(path));
  const points = [...path.matchAll(/([ML])([\d.-]+),([\d.-]+)/g)].map((m) => ({
    command: m[1],
    x: Number(m[2]),
    y: Number(m[3]),
  }));
  assert.equal(points.length, 81);
  for (let i = 1; i < points.length; i++) {
    assert.ok(
      points[i].x >= 0 &&
        points[i].x <= 1000 &&
        points[i].y >= 0 &&
        points[i].y <= 500,
    );
    if (points[i].command === 'L')
      assert.ok(
        Math.abs(points[i].x - points[i - 1].x) <= 500,
        'Date-line crossings start a new path',
      );
  }
}
assert.ok(
  (
    routePath(
      flight('dateline', airport('A', 35, 175), airport('B', 40, -175)),
    ).match(/M/g) ?? []
  ).length >= 2,
);
const ids = new Set();
for (const item of personalFlights) {
  assert.ok(item.id && !ids.has(item.id));
  ids.add(item.id);
  assert.ok(item.date === null || /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  for (const point of [item.from, item.to]) {
    assert.match(point.code, /^[A-Z0-9]{3,4}$/);
    assert.ok(point.name && point.country);
    assert.ok(
      Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90,
    );
    assert.ok(
      Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180,
    );
  }
  assert.ok(!('seat' in item) && !('bookingReference' in item));
}
console.log(
  `Passed: distance totals, repeated routes, date-line and antipodal paths, polar coordinates, empty-state totals, and ${personalFlights.length} supplied records.`,
);
