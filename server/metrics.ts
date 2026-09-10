export const METRIC_UPSERT = `INSERT INTO flight_metrics
  (hour, event, device, motion, samples, total, minimum, maximum)
  VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, ?5)
  ON CONFLICT (hour, event, device, motion) DO UPDATE SET
    samples = samples + 1, total = total + excluded.total,
    minimum = MIN(minimum, excluded.minimum), maximum = MAX(maximum, excluded.maximum)`;
export async function writeMetric(
  db: D1Database,
  event: string,
  device: string,
  reduced: boolean,
  value: number,
) {
  const hour = new Date().toISOString().slice(0, 13) + ':00:00Z';
  await db
    .prepare(METRIC_UPSERT)
    .bind(hour, event, device, reduced ? 'reduced' : 'full', value)
    .run();
}
export async function pruneMetrics(db: D1Database) {
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  await db
    .prepare('DELETE FROM flight_metrics WHERE hour < ?1')
    .bind(cutoff)
    .run();
}
