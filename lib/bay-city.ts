import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { BAY_ORIGIN } from './bay-flight';
import {
  addCityImagery,
  type BaySurfaceControls,
  type SurfaceLayer,
} from './bay-surface';

/** Quarter-metre elevation samples over source pixels 3500–8300 / 5200–10000. */
export type ElevationGrid = { grid: Uint16Array; size: number };

/** Bilinear terrain height in metres at local scene coordinates. */
export function sampleElevation(
  elevation: ElevationGrid,
  x: number,
  z: number,
) {
  const last = elevation.size - 1;
  const col = Math.min(
    last - 1,
    Math.max(0, ((x / 10 + BAY_ORIGIN[0] - 3500) / 4800) * last),
  );
  const row = Math.min(
    last - 1,
    Math.max(0, ((z / 10 + BAY_ORIGIN[1] - 5200) / 4800) * last),
  );
  const c0 = Math.floor(col),
    r0 = Math.floor(row),
    fx = col - c0,
    fz = row - r0;
  const at = (r: number, c: number) => elevation.grid[r * elevation.size + c];
  return (
    ((at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx) * (1 - fz) +
      (at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx) * fz) /
    4
  );
}

/** Building kinds packed by scripts/prepare-city-buildings.py. */
const GLAZING = [0.25, 0.7, 0.12, 1] as const;
const HEADER = 22;

export type CityBuildings = {
  count: number;
  vertexCount: number;
  triangleCount: number;
  records: DataView;
  /** Ring offsets, byte or short pairs per the record's wide flag. */
  vertices: DataView;
  triangles: Uint8Array;
};

/** Parses `bay-buildings.bin` (format v2, see scripts/prepare-city-buildings.py). */
export function parseCityBuildings(buffer: ArrayBuffer): CityBuildings {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < HEADER ||
    String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'BAYB' ||
    view.getUint16(4, true) !== 2
  )
    throw new Error('Unrecognised city buildings file');
  const count = view.getUint32(6, true);
  const vertexCount = view.getUint32(10, true);
  const vertexBytes = view.getUint32(14, true);
  const triangleCount = view.getUint32(18, true);
  const recordsEnd = HEADER + count * 16;
  const verticesEnd = recordsEnd + vertexBytes;
  if (buffer.byteLength < verticesEnd + triangleCount * 3)
    throw new Error('Truncated city buildings file');
  return {
    count,
    vertexCount,
    triangleCount,
    records: new DataView(buffer, HEADER, count * 16),
    vertices: new DataView(buffer, recordsEnd, vertexBytes),
    triangles: new Uint8Array(buffer, verticesEnd, triangleCount * 3),
  };
}

/** Fetches the packed city, inflating it when the server left it gzipped. */
export async function loadCityBuildings(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('City unavailable');
  let buffer = await response.arrayBuffer();
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('City needs DecompressionStream');
    buffer = await new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
  }
  return parseCityBuildings(buffer);
}

/**
 * Extrudes every footprint into one flat-shaded, indexed geometry: a bottom
 * ring sunk below the terrain and a top ring at the roof. Walls face outward
 * for the counter-clockwise rings the script writes. `yieldNow` lets the
 * caller spread the work across frames.
 */
export async function buildCityGeometry(
  city: CityBuildings,
  elevation: ElevationGrid,
  yieldNow?: () => Promise<void>,
) {
  const vertexTotal = city.vertexCount * 2;
  const positions = new Float32Array(vertexTotal * 3);
  const lift = new Float32Array(vertexTotal);
  const colors = new Uint8Array(vertexTotal * 4);
  const indices = new Uint32Array(city.vertexCount * 9 - city.count * 6);
  const ring = new Float32Array(512);
  let vertex = 0,
    index = 0,
    cursor = 0,
    triangle = 0,
    sliceStart = performance.now();
  for (let b = 0; b < city.count; b++) {
    const record = b * 16;
    const cx = city.records.getInt32(record, true) / 2;
    const cz = city.records.getInt32(record + 4, true) / 2;
    const height = city.records.getUint16(record + 8, true) / 10;
    const r = city.records.getUint8(record + 10);
    const g = city.records.getUint8(record + 11);
    const bl = city.records.getUint8(record + 12);
    const flags = city.records.getUint8(record + 13);
    const kind = flags & 0x7f;
    const wide = (flags & 0x80) !== 0;
    const n = city.records.getUint8(record + 14);
    const triangles = city.records.getUint8(record + 15);
    for (let i = 0; i < n; i++) {
      ring[i * 2] =
        cx +
        (wide
          ? city.vertices.getInt16(cursor, true)
          : city.vertices.getInt8(cursor)) /
          2;
      ring[i * 2 + 1] =
        cz +
        (wide
          ? city.vertices.getInt16(cursor + 2, true)
          : city.vertices.getInt8(cursor + 1)) /
          2;
      cursor += wide ? 4 : 2;
    }
    // Walls read lighter and less saturated than the roofs seen from above;
    // towers lean towards curtain-wall glass.
    const luminance = 0.3 * r + 0.59 * g + 0.11 * bl;
    const wall = [r, g, bl].map((channel, i) =>
      Math.min(
        255,
        kind === 3
          ? (channel * 0.4 + luminance * 0.3 + [150, 168, 184][i] * 0.5) | 0
          : ((channel + luminance) * 0.56 + 22) | 0,
      ),
    );
    const glazing = (GLAZING[kind] ?? 0.25) * 255;
    let low = Infinity,
      high = -Infinity;
    for (let i = 0; i < n; i++) {
      const ground = sampleElevation(elevation, ring[i * 2], ring[i * 2 + 1]);
      low = Math.min(low, ground);
      high = Math.max(high, ground);
    }
    const base = low - 1.5;
    const top = high + height;
    const bottomStart = vertex,
      topStart = vertex + n;
    for (let i = 0; i < n; i++) {
      const x = ring[i * 2],
        z = ring[i * 2 + 1];
      const bottom = bottomStart + i,
        roof = topStart + i;
      positions[bottom * 3] = x;
      positions[bottom * 3 + 1] = base;
      positions[bottom * 3 + 2] = z;
      positions[roof * 3] = x;
      positions[roof * 3 + 1] = top;
      positions[roof * 3 + 2] = z;
      lift[roof] = top - base;
      for (const slot of [bottom, roof]) {
        colors[slot * 4] = wall[0];
        colors[slot * 4 + 1] = wall[1];
        colors[slot * 4 + 2] = wall[2];
        colors[slot * 4 + 3] = glazing;
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices[index++] = bottomStart + i;
      indices[index++] = topStart + j;
      indices[index++] = bottomStart + j;
      indices[index++] = bottomStart + i;
      indices[index++] = topStart + i;
      indices[index++] = topStart + j;
    }
    if (triangles === 0) {
      for (let i = 1; i < n - 1; i++) {
        indices[index++] = topStart;
        indices[index++] = topStart + i + 1;
        indices[index++] = topStart + i;
      }
    } else {
      for (let t = 0; t < triangles; t++) {
        const at = (triangle + t) * 3;
        indices[index++] = topStart + city.triangles[at];
        indices[index++] = topStart + city.triangles[at + 2];
        indices[index++] = topStart + city.triangles[at + 1];
      }
      triangle += triangles;
    }
    vertex += n * 2;
    if (yieldNow && performance.now() - sliceStart > 6) {
      await yieldNow();
      sliceStart = performance.now();
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('lift', new BufferAttribute(lift, 1));
  geometry.setAttribute('color', new BufferAttribute(colors, 4, true));
  geometry.setIndex(new BufferAttribute(indices.subarray(0, index), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** One draw call for the whole city, lit like the terrain it stands on. */
export function createCityMesh(
  geometry: BufferGeometry,
  layers: SurfaceLayer[],
  surface: BaySurfaceControls,
) {
  const rise = { value: 0 };
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 0.8,
    metalness: 0.04,
  });
  addCityImagery(material, layers, surface, rise);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { mesh, material, rise };
}
