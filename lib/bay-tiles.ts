import {
  DataTexture,
  LinearFilter,
  NearestFilter,
  NearestMipmapNearestFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { SurfaceLayer } from './bay-surface';

/**
 * Streamed ground imagery along the scroll path. scripts/prepare-bay-tiles.py
 * replays the flight's camera for every scroll bucket and records which
 * tiles of a six-level pyramid the frame will look at; this module keeps
 * those tiles resident in one atlas texture a little ahead of the scroll,
 * and publishes a page table (one texel per page, with mips per level)
 * that the terrain shader reads to find the best resident page for any
 * ground point. Two samplers replace whole-texture layers, so neither the
 * 16-sampler limit nor the 8192 px texture cap bounds the ground detail.
 */

export type TileManifest = {
  version: number;
  bounds: [number, number, number, number];
  pages: number;
  tile: number;
  border: number;
  levels: number;
  resolution: number;
  step: number;
  lodBias: number;
  tiles: number;
  bytes?: number;
  /** Always resident: the coarsest levels over the whole region. */
  floor?: number[];
  /** Wanted while the scroll is below `until`: the airport at 2.4 m. */
  airport?: { until: number; tiles: number[] };
  buckets: number[][];
};

export const tileId = (level: number, x: number, y: number) =>
  (level << 16) | (y << 8) | x;
export const tileLevel = (id: number) => id >> 16;
export const tileX = (id: number) => id & 255;
export const tileY = (id: number) => (id >> 8) & 255;

/**
 * Page tables for every level, coarse to fine, each texel holding the
 * atlas slot and level of the best resident page covering it (alpha 255)
 * or nothing (alpha 0). Finer levels inherit their parent's entry, so a
 * lookup at any level finds the best resident ancestor. Returns the full
 * mip chain down to 1 × 1 so the texture is mipmap-complete.
 */
export function buildPageTables(
  pages: number,
  levels: number,
  atlasTiles: number,
  resident: Map<number, number>,
) {
  const chain: Uint8Array[] = [];
  let size = pages;
  const dims: number[] = [];
  while (size >= 1) {
    dims.push(size);
    size >>= 1;
  }
  const tables = dims.map((d) => new Uint8Array(d * d * 4));
  for (let level = dims.length - 1; level >= 0; level--) {
    const d = dims[level];
    const table = tables[level];
    const parent = tables[level + 1];
    for (let y = 0; y < d; y++)
      for (let x = 0; x < d; x++) {
        const o = (y * d + x) * 4;
        const slot = level < levels ? resident.get(tileId(level, x, y)) : undefined;
        if (slot !== undefined) {
          table[o] = slot % atlasTiles;
          table[o + 1] = Math.floor(slot / atlasTiles);
          table[o + 2] = level;
          table[o + 3] = 255;
        } else if (parent) {
          const po = ((y >> 1) * (d >> 1) + (x >> 1)) * 4;
          table[o] = parent[po];
          table[o + 1] = parent[po + 1];
          table[o + 2] = parent[po + 2];
          table[o + 3] = parent[po + 3];
        }
      }
    chain.push(table);
  }
  return { tables, dims };
}

export function createTileStreamer(
  renderer: WebGLRenderer,
  manifest: TileManifest,
  options: {
    /** Skip levels finer than this (1 halves the bytes on phones). */
    minLevel?: number;
    /** Tiles per atlas edge; 24 gives 576 resident tiles in a 6336² texture. */
    atlasTiles?: number;
    /** Buckets to keep ahead of the scroll. */
    lookahead?: number;
    concurrency?: number;
    base?: string;
  } = {},
) {
  const { pages, tile, border, levels } = manifest;
  const minLevel = options.minLevel ?? 0;
  const atlasTiles = options.atlasTiles ?? 24;
  const lookahead = options.lookahead ?? 10;
  const concurrency = options.concurrency ?? 6;
  const base = options.base ?? '/tiles/';
  const cell = tile + 2 * border;
  const atlasSize = atlasTiles * cell;

  // A render target allocates the atlas on the GPU without a CPU buffer;
  // tiles are copied into it with texSubImage2D.
  const atlasTarget = new WebGLRenderTarget(atlasSize, atlasSize, {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const atlas = atlasTarget.texture;
  atlas.flipY = true;
  atlas.name = 'bay-tile-atlas';
  renderer.initRenderTarget(atlasTarget);

  const resident = new Map<number, number>();
  const { tables, dims } = buildPageTables(pages, levels, atlasTiles, resident);
  const pageTable = new DataTexture(tables[0], pages, pages, RGBAFormat, UnsignedByteType);
  pageTable.mipmaps = tables.map((data, i) => ({ data, width: dims[i], height: dims[i] }));
  pageTable.colorSpace = NoColorSpace;
  pageTable.flipY = false;
  pageTable.generateMipmaps = false;
  pageTable.minFilter = NearestMipmapNearestFilter;
  pageTable.magFilter = NearestFilter;
  pageTable.name = 'bay-tile-pages';
  pageTable.needsUpdate = true;

  // Slot bookkeeping: which tile sits in each slot, and when it was last wanted.
  const slotTile = new Int32Array(atlasTiles * atlasTiles).fill(-1);

  const layer: SurfaceLayer = {
    bounds: manifest.bounds,
    feather: 0,
    virtual: {
      pageTable,
      atlas,
      pages,
      tile,
      border,
      atlasTiles,
      levels,
      lodBias: manifest.lodBias,
    },
  };

  const lastWanted = new Map<number, number>();
  const pending = new Map<number, AbortController>();
  const failed = new Set<number>();
  let wanted: number[] = [];
  let wantedSet = new Set<number>();
  /** Tiles kept from eviction: the current bucket and its near future. */
  let protect = new Set<number>();
  /** Set when the atlas had no slot for a wanted tile; cleared on change. */
  let starved = false;
  let generation = 0;
  let dirty = false;
  let disposed = false;
  let inflight = 0;
  let loaded = 0;
  let bytes = 0;
  let lastBucket = -1;
  let lastUpdate = -Infinity;
  let primed: { bucket: number; resolve: () => void } | null = null;
  const position = new Vector2();

  // The coarsest levels over the whole region are cheap and make a floor
  // under everything, wanted from the start and never evicted; the airport
  // square at 2.4 m joins them while the aircraft is low.
  const floor = new Set<number>(manifest.floor ?? []);
  if (!manifest.floor)
    for (const bucket of manifest.buckets)
      for (const id of bucket) if (tileLevel(id) === levels - 1) floor.add(id);
  const airport = manifest.airport ?? { until: 0, tiles: [] };
  const airportUntil = Math.round(airport.until / manifest.step);

  const bucketOf = (progress: number) =>
    Math.max(0, Math.min(manifest.buckets.length - 1, Math.round(progress / manifest.step)));

  function wantedFor(bucket: number) {
    const order: number[] = [];
    const seen = new Set<number>();
    const near = new Set<number>();
    const add = (id: number, keep: boolean) => {
      if (tileLevel(id) < minLevel) return;
      if (keep) near.add(id);
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
    };
    for (const id of floor) add(id, true);
    for (const id of manifest.buckets[bucket]) add(id, true);
    if (bucket <= airportUntil) for (const id of airport.tiles) add(id, true);
    for (let k = 1; k <= lookahead; k++) {
      const ahead = manifest.buckets[bucket + k];
      if (ahead) for (const id of ahead) add(id, k <= 4);
      if (k <= 2) {
        const behind = manifest.buckets[bucket - k];
        if (behind) for (const id of behind) add(id, false);
      }
    }
    // Never want more than the atlas can hold, or tiles would be fetched,
    // evicted for other wanted tiles and fetched again. Priority order
    // means the floor, the current bucket and the near future always fit.
    const capacity = slotTile.length - 4;
    const fitted = order.length > capacity ? order.slice(0, capacity) : order;
    protect = new Set(fitted);
    for (const id of near) if (!protect.has(id)) near.delete(id);
    return fitted;
  }

  function freeSlot(protect: Set<number>) {
    for (let s = 0; s < slotTile.length; s++) if (slotTile[s] < 0) return s;
    // Evict the resident tile least recently wanted that nobody needs now.
    let victim = -1;
    let oldest = Infinity;
    for (let s = 0; s < slotTile.length; s++) {
      const id = slotTile[s];
      if (protect.has(id) || floor.has(id)) continue;
      const when = lastWanted.get(id) ?? -Infinity;
      if (when < oldest) {
        oldest = when;
        victim = s;
      }
    }
    if (victim < 0) return -1;
    resident.delete(slotTile[victim]);
    slotTile[victim] = -1;
    return victim;
  }

  function place(id: number, bitmap: ImageBitmap) {
    const slot = freeSlot(protect);
    if (slot < 0) {
      // Full of tiles that are still needed: stop fetching until the
      // scroll moves on and frees some.
      starved = true;
      bitmap.close();
      return;
    }
    const source = new Texture(bitmap);
    source.colorSpace = SRGBColorSpace;
    source.flipY = true;
    position.set((slot % atlasTiles) * cell, Math.floor(slot / atlasTiles) * cell);
    renderer.copyTextureToTexture(source, atlas, null, position);
    source.dispose();
    bitmap.close();
    slotTile[slot] = id;
    resident.set(id, slot);
    dirty = true;
  }

  function publish() {
    if (!dirty) return;
    dirty = false;
    const built = buildPageTables(pages, levels, atlasTiles, resident);
    pageTable.image.data = built.tables[0];
    pageTable.mipmaps = built.tables.map((data, i) => ({ data, width: built.dims[i], height: built.dims[i] }));
    pageTable.needsUpdate = true;
    if (primed && manifest.buckets[primed.bucket].every((id) => tileLevel(id) < minLevel || resident.has(id) || failed.has(id))) {
      primed.resolve();
      primed = null;
    }
  }

  function pump() {
    if (disposed || starved) return;
    for (const id of wanted) {
      if (inflight >= concurrency) break;
      if (resident.has(id) || pending.has(id) || failed.has(id)) continue;
      const controller = new AbortController();
      pending.set(id, controller);
      inflight++;
      const url = `${base}${tileLevel(id)}-${tileX(id)}-${tileY(id)}.webp`;
      const started = generation;
      void fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          bytes += blob.size;
          return createImageBitmap(blob, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          });
        })
        .then((bitmap) => {
          if (disposed) {
            bitmap.close();
            return;
          }
          loaded++;
          // Still wanted, or at least still recent: place it.
          if (wantedSet.has(id) || started === generation) place(id, bitmap);
          else bitmap.close();
        })
        .catch(() => {
          if (!controller.signal.aborted) failed.add(id);
        })
        .finally(() => {
          pending.delete(id);
          inflight--;
          publish();
          pump();
        });
    }
    publish();
  }

  function update(progress: number, now = performance.now()) {
    if (disposed) return;
    const bucket = bucketOf(progress);
    if (bucket === lastBucket && now - lastUpdate < 150) return;
    lastBucket = bucket;
    lastUpdate = now;
    generation++;
    starved = false;
    wanted = wantedFor(bucket);
    wantedSet = new Set(wanted);
    for (const id of wanted) lastWanted.set(id, now);
    // Drop fetches nobody wants any more.
    for (const [id, controller] of pending)
      if (!wantedSet.has(id)) {
        controller.abort();
        pending.delete(id);
      }
    pump();
  }

  return {
    layer,
    pageTable,
    atlas,
    update,
    /** Resolves once every tile of the bucket at `progress` is resident, or after `timeoutMs`. */
    prime(progress: number, timeoutMs = 12000) {
      const bucket = bucketOf(progress);
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          primed = null;
          resolve();
        }, timeoutMs);
        primed = {
          bucket,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        update(progress, performance.now() + 1000);
        publish();
      });
    },
    /** Development probes: slot contents and the atlas target for read-back. */
    debug() {
      return {
        atlasTarget,
        cell,
        atlasTiles,
        slotTile: Array.from(slotTile),
        resident: Array.from(resident.entries()),
      };
    },
    stats() {
      return {
        resident: resident.size,
        pending: pending.size,
        loaded,
        failed: failed.size,
        bytes,
        slots: atlasTiles * atlasTiles,
      };
    },
    dispose() {
      disposed = true;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      atlasTarget.dispose();
      pageTable.dispose();
    },
  };
}
