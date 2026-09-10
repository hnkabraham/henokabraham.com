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
  reuse?: Uint8Array[],
) {
  let size = pages;
  const dims: number[] = [];
  while (size >= 1) {
    dims.push(size);
    size >>= 1;
  }
  const tables = reuse ?? dims.map((d) => new Uint8Array(d * d * 4));
  tables.forEach((table) => table.fill(0));
  for (let level = dims.length - 1; level >= 0; level--) {
    const d = dims[level];
    const table = tables[level];
    const parent = tables[level + 1];
    for (let y = 0; y < d; y++)
      for (let x = 0; x < d; x++) {
        const o = (y * d + x) * 4;
        const slot =
          level < levels ? resident.get(tileId(level, x, y)) : undefined;
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
  }
  return { tables, dims };
}

export type TileOptions = {
  minLevel?: number;
  atlasTiles?: number;
  lookahead?: number;
  concurrency?: number;
  uploadBudget?: number;
  retryDelayMs?: number;
  base?: string;
};

/** Derive a floor and detail level that fit every bucket on this GPU. */
export function tileLayout(
  manifest: TileManifest,
  maxTextureSize: number,
  options: TileOptions = {},
) {
  const cell = manifest.tile + 2 * manifest.border;
  const atlasTiles = Math.min(
    options.atlasTiles ?? 24,
    Math.floor(maxTextureSize / cell),
  );
  const capacity = atlasTiles * atlasTiles - 4;
  let minLevel = options.minLevel ?? 0;
  const coarse = [
    ...new Set([...(manifest.floor ?? []), ...manifest.buckets.flat()]),
  ].filter((id) => tileLevel(id) === manifest.levels - 1);
  let floor = minLevel > 0 ? coarse : (manifest.floor ?? coarse);
  const fits = () =>
    manifest.buckets.every(
      (bucket) =>
        new Set([...floor, ...bucket.filter((id) => tileLevel(id) >= minLevel)])
          .size <= capacity,
    );
  if (!fits()) floor = coarse;
  // A sub-4096 GPU may not fit even the regional floor. Whole-image layers
  // cover the distance there; reserve the atlas for its current view instead.
  if (floor.length > capacity) floor = [];
  // Very small texture limits must reduce detail, never truncate an opening
  // bucket. The manifest already includes the ancestors of each fine page.
  while (!fits() && minLevel < manifest.levels - 1) minLevel++;
  if (!fits()) throw new Error('Texture limit cannot hold the tile floor');
  return { atlasTiles, capacity, minLevel, floor };
}

/** Current coverage is mandatory; the airport and lookahead use spare slots. */
export function wantedTiles(
  manifest: TileManifest,
  layout: ReturnType<typeof tileLayout>,
  bucket: number,
  lookahead = 10,
  direction = 1,
) {
  const order = new Set<number>();
  const add = (ids: number[] = []) => {
    for (const id of ids)
      if (tileLevel(id) >= layout.minLevel && order.size < layout.capacity)
        order.add(id);
  };
  add(manifest.buckets[bucket]);
  add(layout.floor);
  if (bucket <= Math.round((manifest.airport?.until ?? -1) / manifest.step))
    add(manifest.airport?.tiles);
  for (let k = 1; k <= lookahead; k++) {
    add(manifest.buckets[bucket + direction * k]);
    if (k <= 2) add(manifest.buckets[bucket - direction * k]);
  }
  return [...order];
}

export function createTileStreamer(
  renderer: WebGLRenderer,
  manifest: TileManifest,
  options: TileOptions = {},
) {
  const { pages, tile, border, levels } = manifest;
  const layout = tileLayout(
    manifest,
    renderer.capabilities.maxTextureSize,
    options,
  );
  const { minLevel, atlasTiles } = layout;
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const uploadBudget = Math.max(1, options.uploadBudget ?? 4);
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const base = options.base ?? '/tiles/';
  const cell = tile + 2 * border;
  const atlasSize = atlasTiles * cell;
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
  const pageTable = new DataTexture(
    tables[0],
    pages,
    pages,
    RGBAFormat,
    UnsignedByteType,
  );
  pageTable.mipmaps = tables.map((data, i) => ({
    data,
    width: dims[i],
    height: dims[i],
  }));
  pageTable.colorSpace = NoColorSpace;
  pageTable.flipY = false;
  pageTable.generateMipmaps = false;
  pageTable.minFilter = NearestMipmapNearestFilter;
  pageTable.magFilter = NearestFilter;
  pageTable.name = 'bay-tile-pages';
  pageTable.needsUpdate = true;
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
  const decoded = new Map<
    number,
    { bitmap: ImageBitmap; request: AbortController }
  >();
  const failed = new Map<number, number>();
  let wanted: number[] = [];
  let wantedSet = new Set<number>();
  let disposed = false;
  let active = true;
  let inflight = 0;
  let loaded = 0;
  let bytes = 0;
  let publications = 0;
  let lastBucket = -1;
  let direction = 1;
  let primed: { bucket: number; resolve: () => void } | null = null;
  const position = new Vector2();
  const bucketOf = (progress: number) =>
    Math.max(
      0,
      Math.min(
        manifest.buckets.length - 1,
        Math.round(progress / manifest.step),
      ),
    );

  function settlePrime() {
    const current = primed;
    primed = null;
    current?.resolve();
  }
  function checkPrime() {
    if (
      primed &&
      manifest.buckets[primed.bucket].every(
        (id) => tileLevel(id) < minLevel || resident.has(id),
      )
    )
      settlePrime();
  }
  function freeSlot() {
    for (let s = 0; s < slotTile.length; s++) if (slotTile[s] < 0) return s;
    let victim = -1;
    let oldest = Infinity;
    for (let s = 0; s < slotTile.length; s++) {
      const id = slotTile[s];
      if (wantedSet.has(id)) continue;
      const when = lastWanted.get(id) ?? -Infinity;
      if (when < oldest) {
        oldest = when;
        victim = s;
      }
    }
    if (victim >= 0) {
      // Slot ownership is checked even though placement is idempotent.
      if (resident.get(slotTile[victim]) === victim)
        resident.delete(slotTile[victim]);
      slotTile[victim] = -1;
    }
    return victim;
  }
  function pump(now = performance.now()) {
    if (disposed || !active) return;
    for (const id of wanted) {
      // Bound decoded CPU memory as well as simultaneous fetch/decode work.
      if (inflight + decoded.size >= concurrency) break;
      if (
        resident.has(id) ||
        pending.has(id) ||
        decoded.has(id) ||
        (failed.get(id) ?? -Infinity) > now
      )
        continue;
      const request = new AbortController();
      pending.set(id, request);
      inflight++;
      const valid = () =>
        !disposed && !request.signal.aborted && pending.get(id) === request;
      void fetch(`${base}${tileLevel(id)}-${tileX(id)}-${tileY(id)}.webp`, {
        signal: request.signal,
      })
        .then((response) => {
          if (!valid() || !response.ok)
            throw new Error('Tile request unavailable');
          return response.blob();
        })
        .then((blob) => {
          if (!valid()) throw new Error('Tile request cancelled');
          bytes += blob.size;
          return createImageBitmap(blob, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          });
        })
        .then((bitmap) => {
          if (
            !valid() ||
            !wantedSet.has(id) ||
            resident.has(id) ||
            decoded.has(id)
          ) {
            bitmap.close();
            return;
          }
          failed.delete(id);
          loaded++;
          decoded.set(id, { bitmap, request });
        })
        .catch(() => {
          if (valid()) failed.set(id, performance.now() + retryDelayMs);
        })
        .finally(() => {
          // Aborted decodes can outlive a newer request for the same tile.
          if (pending.get(id) === request) pending.delete(id);
          inflight--;
          pump();
        });
    }
  }
  function update(progress: number, now = performance.now()) {
    if (disposed || !active) return;
    const bucket = bucketOf(progress);
    if (bucket !== lastBucket) {
      if (lastBucket >= 0) direction = Math.sign(bucket - lastBucket);
      lastBucket = bucket;
      wanted = wantedTiles(
        manifest,
        layout,
        bucket,
        options.lookahead ?? 10,
        direction,
      );
      wantedSet = new Set(wanted);
      for (const id of wanted) lastWanted.set(id, now);
      for (const [id, request] of pending) {
        if (wantedSet.has(id)) continue;
        request.abort();
        if (pending.get(id) === request) pending.delete(id);
      }
      for (const [id, entry] of decoded) {
        if (wantedSet.has(id)) continue;
        entry.bitmap.close();
        decoded.delete(id);
      }
    }
    pump(now);
    checkPrime();
  }
  /** Upload and publish together before drawing; completion callbacks do no GPU work. */
  function flush(now = performance.now()) {
    if (disposed || !active) return false;
    let uploads = 0;
    let dirty = false;
    for (const id of wanted) {
      if (uploads >= uploadBudget) break;
      const entry = decoded.get(id);
      if (!entry) continue;
      const { bitmap, request } = entry;
      if (request.signal.aborted || resident.has(id)) {
        bitmap.close();
        decoded.delete(id);
        continue;
      }
      const slot = freeSlot();
      if (slot < 0) break;
      const source = new Texture(bitmap);
      source.colorSpace = SRGBColorSpace;
      source.flipY = true;
      position.set(
        (slot % atlasTiles) * cell,
        Math.floor(slot / atlasTiles) * cell,
      );
      dirty = true;
      try {
        renderer.copyTextureToTexture(source, atlas, null, position);
        slotTile[slot] = id;
        resident.set(id, slot);
      } catch {
        failed.set(id, now + retryDelayMs);
      } finally {
        source.dispose();
        bitmap.close();
        decoded.delete(id);
      }
      uploads++;
    }
    if (dirty) {
      buildPageTables(pages, levels, atlasTiles, resident, tables);
      pageTable.needsUpdate = true;
      publications++;
    }
    checkPrime();
    pump(now);
    return dirty;
  }
  return {
    layer,
    pageTable,
    atlas,
    update,
    flush,
    setActive(value: boolean) {
      active = value;
    },
    /** Failures retry; only coverage, disposal or the twelve-second cap settles priming. */
    prime(progress: number, timeoutMs = 12000) {
      settlePrime();
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(settlePrime, Math.min(timeoutMs, 12000));
        primed = {
          bucket: bucketOf(progress),
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        update(progress);
        checkPrime();
      });
    },
    debug() {
      return {
        atlasTarget,
        cell,
        atlasTiles,
        minLevel,
        floor: layout.floor,
        wanted,
        slotTile: Array.from(slotTile),
        resident: Array.from(resident.entries()),
        publications,
      };
    },
    stats() {
      return {
        resident: resident.size,
        pending: pending.size,
        decoded: decoded.size,
        loaded,
        failed: failed.size,
        bytes,
        slots: slotTile.length,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      settlePrime();
      for (const request of pending.values()) request.abort();
      pending.clear();
      for (const { bitmap } of decoded.values()) bitmap.close();
      decoded.clear();
      atlasTarget.dispose();
      pageTable.dispose();
    },
  };
}
