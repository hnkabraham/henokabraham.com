import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from 'three';
import { sampleElevation, type ElevationGrid } from './bay-city';

/**
 * Freeway traffic under the climb-out: US 101, I-380 and I-280 between the
 * airport and San Bruno Mountain, from OpenStreetMap carriageways packed by
 * scripts/prepare-bay-traffic.py. Every vehicle is one instance of a merged
 * body-and-cabin box, spread across the lanes of its carriageway and driven
 * along the polyline at its own speed, so the roads read as moving streams
 * from a few hundred metres up rather than as painted grey strips.
 */

export type RoadNetwork = {
  ways: {
    ref: string;
    kind: 'motorway' | 'link';
    lanes: number;
    points: [number, number][];
  }[];
};

const LANE_WIDTH = 3.65;
/** Metres of carriageway per vehicle, per lane. */
const SPACING = { motorway: 78, link: 150 };
/** Weighted paint palette, roughly the mix on a Bay Area freeway. */
const PAINT: [string, number][] = [
  ['#e9e9e6', 24],
  ['#1c1e22', 18],
  ['#7d8085', 16],
  ['#b9bcc0', 15],
  ['#2c4a7a', 9],
  ['#9a2a25', 8],
  ['#8a7a63', 5],
  ['#3d5c3f', 3],
  ['#d8b545', 2],
];

const hash = (seed: number) => {
  let h = (seed * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** A car body with a cabin set back on it, length along +X, resting at y = 0. */
function createVehicleGeometry() {
  const parts: BufferGeometry[] = [
    new BoxGeometry(4.5, 0.72, 1.85).translate(0, 0.66, 0),
    new BoxGeometry(2.3, 0.6, 1.65).translate(-0.25, 1.28, 0),
  ];
  let count = 0;
  for (const part of parts) count += part.getAttribute('position').count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const index: number[] = [];
  let offset = 0;
  for (const part of parts) {
    const p = part.getAttribute('position'),
      n = part.getAttribute('normal');
    positions.set(p.array as Float32Array, offset * 3);
    normals.set(n.array as Float32Array, offset * 3);
    const ix = part.getIndex()!;
    for (let i = 0; i < ix.count; i++) index.push(ix.getX(i) + offset);
    offset += p.count;
    part.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

type Carriageway = {
  xs: Float32Array;
  ys: Float32Array;
  zs: Float32Array;
  cum: Float32Array;
  length: number;
};

type Vehicle = {
  way: number;
  start: number;
  speed: number;
  offset: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  segment: number;
};

export function createTraffic(
  data: RoadNetwork,
  elevation: ElevationGrid,
  options: { density?: number } = {},
) {
  const density = options.density ?? 1;
  const ways: Carriageway[] = data.ways.map((way) => {
    const n = way.points.length;
    const xs = new Float32Array(n),
      ys = new Float32Array(n),
      zs = new Float32Array(n),
      cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = way.points[i];
      xs[i] = x;
      zs[i] = z;
      ys[i] = sampleElevation(elevation, x, z) + 0.25;
      cum[i] =
        i === 0 ? 0 : cum[i - 1] + Math.hypot(x - xs[i - 1], z - zs[i - 1]);
    }
    return { xs, ys, zs, cum, length: cum[n - 1] };
  });

  const vehicles: Vehicle[] = [];
  const colors: number[] = [];
  const paintTotal = PAINT.reduce((sum, [, weight]) => sum + weight, 0);
  const paint = new Color();
  data.ways.forEach((way, w) => {
    const road = ways[w];
    const spacing = SPACING[way.kind] / density;
    for (let lane = 0; lane < way.lanes; lane++) {
      const count = Math.floor(road.length / spacing);
      const seed = w * 97 + lane * 13;
      for (let k = 0; k < count; k++) {
        const s = hash(seed + k * 7 + 1);
        const truck =
          hash(seed + k * 7 + 2) < (way.kind === 'motorway' ? 0.11 : 0.05);
        // Outer lanes run slower; links are ramps.
        const pace =
          way.kind === 'motorway'
            ? 33 - lane * 1.6 - (truck ? 5 : 0)
            : 16 - (truck ? 3 : 0);
        vehicles.push({
          way: w,
          start: ((k + s * 0.8) * spacing) % road.length,
          speed: pace * (0.94 + 0.12 * hash(seed + k * 7 + 3)),
          offset: (lane + 0.5 - way.lanes / 2) * LANE_WIDTH,
          scaleX: truck ? 2.9 : 0.92 + 0.16 * hash(seed + k * 7 + 4),
          scaleY: truck ? 2.3 : 0.95 + 0.1 * hash(seed + k * 7 + 5),
          scaleZ: truck ? 1.35 : 1,
          segment: 0,
        });
        let pick = hash(seed + k * 7 + 6) * paintTotal;
        let hex = PAINT[0][0];
        for (const [color, weight] of PAINT) {
          hex = color;
          pick -= weight;
          if (pick <= 0) break;
        }
        paint.set(truck && hash(seed + k * 7 + 8) < 0.6 ? '#e9e9e6' : hex);
        colors.push(paint.r, paint.g, paint.b);
      }
    }
  });

  const geometry = createVehicleGeometry();
  const material = new MeshStandardMaterial({
    roughness: 0.5,
    metalness: 0.25,
  });
  const mesh = new InstancedMesh(geometry, material, vehicles.length);
  mesh.name = 'bay-traffic';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(
    new Float32Array(colors),
    3,
  );
  // One bounding sphere for the whole network keeps culling cheap.
  const bounds = new Sphere(new Vector3(), 0);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const road of ways)
    for (let i = 0; i < road.xs.length; i++) {
      minX = Math.min(minX, road.xs[i]);
      maxX = Math.max(maxX, road.xs[i]);
      minZ = Math.min(minZ, road.zs[i]);
      maxZ = Math.max(maxZ, road.zs[i]);
    }
  bounds.center.set((minX + maxX) / 2, 20, (minZ + maxZ) / 2);
  bounds.radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 100;
  geometry.boundingSphere = bounds;
  mesh.frustumCulled = true;

  const matrices = mesh.instanceMatrix.array as Float32Array;
  function update(now: number) {
    const t = now * 0.001;
    for (let v = 0; v < vehicles.length; v++) {
      const vehicle = vehicles[v];
      const road = ways[vehicle.way];
      const s = (vehicle.start + vehicle.speed * t) % road.length;
      // Vehicles only move forward, so the cached segment is at most a few
      // steps behind until the polyline wraps.
      let i = vehicle.segment;
      if (road.cum[i] > s) i = 0;
      while (i < road.cum.length - 2 && road.cum[i + 1] < s) i++;
      vehicle.segment = i;
      const span = road.cum[i + 1] - road.cum[i] || 1;
      const f = (s - road.cum[i]) / span;
      const dx = (road.xs[i + 1] - road.xs[i]) / span,
        dz = (road.zs[i + 1] - road.zs[i]) / span;
      // Right of the direction of travel, in a frame with X east and Z south.
      const rx = -dz,
        rz = dx;
      const x =
        road.xs[i] + (road.xs[i + 1] - road.xs[i]) * f + rx * vehicle.offset;
      const y = road.ys[i] + (road.ys[i + 1] - road.ys[i]) * f;
      const z =
        road.zs[i] + (road.zs[i + 1] - road.zs[i]) * f + rz * vehicle.offset;
      // Rotation about Y aligning +X with the travel direction, then scale.
      const c = dx,
        sn = -dz;
      const m = v * 16;
      matrices[m] = vehicle.scaleX * c;
      matrices[m + 1] = 0;
      matrices[m + 2] = -vehicle.scaleX * sn;
      matrices[m + 3] = 0;
      matrices[m + 4] = 0;
      matrices[m + 5] = vehicle.scaleY;
      matrices[m + 6] = 0;
      matrices[m + 7] = 0;
      matrices[m + 8] = vehicle.scaleZ * sn;
      matrices[m + 9] = 0;
      matrices[m + 10] = vehicle.scaleZ * c;
      matrices[m + 11] = 0;
      matrices[m + 12] = x;
      matrices[m + 13] = y;
      matrices[m + 14] = z;
      matrices[m + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);

  return {
    mesh,
    geometry,
    material,
    count: vehicles.length,
    kilometres: ways.reduce((sum, road) => sum + road.length, 0) / 1000,
    update,
  };
}
