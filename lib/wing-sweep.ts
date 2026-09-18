import { Object3D, PerspectiveCamera } from 'three';
import { projectWing, projectTail, type WingPolygon } from './dreamliner-cut';
import { sampleDreamlinerTour } from './dreamliner-tour';

const END = 0.34;
const STEPS = 170;
const COLUMNS = 48;

/** Lower edge at x, inset slightly so the cut is concealed by the wing. */
function lowerEdge(polygons: WingPolygon[], x: number, inset = 8) {
  let y = -Infinity;
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i += 3) {
      const j = (i + 3) % poly.length;
      const ax = poly[i],
        bx = poly[j];
      if ((ax <= x && bx > x) || (bx <= x && ax > x)) {
        const t = (x - ax) / (bx - ax);
        y = Math.max(y, poly[i + 1] + t * (poly[j + 1] - poly[i + 1]) - inset);
      }
    }
  }
  return y;
}

/**
 * The area the real wing has swept, indexed by the rendered tour position.
 * Bake once per viewport, not once per frame. Sampling a cumulative envelope
 * makes both fast jumps and reverse scrolling independent of frame history;
 * letters stay erased when the wing climbs back out of the frame.
 */
export function createWingSweep(width: number, height: number) {
  const camera = new PerspectiveCamera(34, width / height, 0.15, 1200);
  const aircraft = new Object3D();
  aircraft.rotation.order = 'YXZ';
  const rows: Float32Array[] = [];
  let previous = new Float32Array(COLUMNS + 1).fill(-1);
  for (let step = 0; step <= STEPS; step++) {
    const shot = sampleDreamlinerTour((step / STEPS) * END, width / height);
    camera.position.set(...shot.camera);
    camera.lookAt(...shot.target);
    camera.fov = shot.fov;
    camera.setViewOffset(
      width,
      height,
      width * shot.offsetX,
      height * shot.offsetY,
      width,
      height,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    aircraft.position.set(...shot.aircraft);
    aircraft.rotation.set(shot.bank, shot.heading, 0);
    aircraft.updateMatrixWorld(true);
    const polygons = shot.visible
      ? projectWing(camera, aircraft, shot.flex, width, height)
      : [];
    const row = Float32Array.from(previous, (y, column) =>
      Math.max(y, lowerEdge(polygons, (column / COLUMNS) * width) / height),
    );
    rows.push(row);
    previous = row;
  }
  const front = new Float32Array(COLUMNS + 1);
  return (progress: number): Float32Array => {
    const at = Math.max(0, Math.min(STEPS, (progress / END) * STEPS));
    const low = Math.floor(at),
      high = Math.min(STEPS, low + 1),
      t = at - low;
    for (let i = 0; i <= COLUMNS; i++)
      front[i] = rows[low][i] + (rows[high][i] - rows[low][i]) * t;
    return front;
  };
}

/** Upward tail sweep for Apps; cached separately so the opening is untouched. */
export function createTailSweep(width: number, height: number) {
  const start = 0.34,
    end = 0.49,
    steps = 150;
  const camera = new PerspectiveCamera(34, width / height, 0.15, 1200);
  const aircraft = new Object3D();
  aircraft.rotation.order = 'YXZ';
  const rows: Float32Array[] = [];
  let previous = new Float32Array(COLUMNS + 1).fill(2);
  rows.push(previous);
  for (let step = 1; step <= steps; step++) {
    const shot = sampleDreamlinerTour(
      start + (step / steps) * (end - start),
      width / height,
    );
    camera.position.set(...shot.camera);
    camera.lookAt(...shot.target);
    camera.fov = shot.fov;
    camera.setViewOffset(
      width,
      height,
      width * shot.offsetX,
      height * shot.offsetY,
      width,
      height,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    aircraft.position.set(...shot.aircraft);
    aircraft.rotation.set(shot.bank, shot.heading, 0);
    aircraft.updateMatrixWorld(true);
    // Reflect screen Y to reuse the same envelope math for the upward pass.
    const polygons = projectTail(camera, aircraft, width, height).map((poly) =>
      poly.map((v, i) => (i % 3 === 1 ? height - v : v)),
    );
    const row = Float32Array.from(previous, (y, column) =>
      Math.min(
        y,
        1 - lowerEdge(polygons, (column / COLUMNS) * width, 4) / height,
      ),
    );
    rows.push(row);
    previous = row;
  }
  const front = new Float32Array(COLUMNS + 1);
  return (progress: number): Float32Array => {
    const at = Math.max(
      0,
      Math.min(steps, ((progress - start) / (end - start)) * steps),
    );
    const low = Math.floor(at),
      high = Math.min(steps, low + 1),
      t = at - low;
    for (let i = 0; i <= COLUMNS; i++)
      front[i] = rows[low][i] + (rows[high][i] - rows[low][i]) * t;
    return front;
  };
}
