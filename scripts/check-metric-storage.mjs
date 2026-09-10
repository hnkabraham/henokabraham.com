import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { writeMetric, pruneMetrics } from '../server/metrics.ts';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(await readFile(new URL('../migrations/0001_flight_metrics.sql', import.meta.url), 'utf8'));
const db = { prepare: (sql) => ({ bind: (...args) => ({ run: async () => sqlite.prepare(sql).run(...args) }) }) };
try {
  await Promise.all(Array.from({ length: 100 }, (_, n) => writeMetric(db, 'scene_fps', 'phone', false, n + 1)));
  await writeMetric(db, 'scene_fps', 'desktop', false, 60);
  const row = sqlite.prepare("SELECT * FROM flight_metrics WHERE device='phone'").get();
  assert.equal(row.samples, 100);
  assert.equal(row.total / row.samples, 50.5);
  assert.equal(row.minimum, 1); assert.equal(row.maximum, 100);
  sqlite.prepare('INSERT INTO flight_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('2020-01-01T00:00:00Z', 'scene_fps', 'phone', 'full', 1, 30, 30, 30);
  await pruneMetrics(db);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM flight_metrics').get().n, 2);
  console.log('Metric storage passed: atomic counts/averages/extrema, separate device groups, 90-day retention.');
} finally { sqlite.close(); }
