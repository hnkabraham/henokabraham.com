import assert from 'node:assert/strict';

/** Exercise the real streamer with controlled fetch/decode timing and no network or GPU. */
export async function checkTileStreamer({ createTileStreamer, tileId }) {
  const savedFetch = globalThis.fetch;
  const savedDecode = globalThis.createImageBitmap;
  const tick = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const A = tileId(0, 0, 0),
    B = tileId(0, 1, 0),
    C = tileId(0, 2, 0);
  const manifest = {
    pages: 4,
    tile: 4,
    border: 1,
    levels: 1,
    bounds: [0, 0, 1, 1],
    lodBias: 0,
    step: 1,
    floor: [],
    buckets: [[A], [B]],
    tiles: 2,
  };
  const streamers = [];
  const calls = [],
    decodes = [],
    bitmaps = [],
    uploads = [];
  let disposedTargets = 0;
  globalThis.fetch = (url, { signal }) =>
    new Promise((resolve) => calls.push({ url, signal, resolve }));
  globalThis.createImageBitmap = (blob) =>
    new Promise((resolve) => decodes.push({ blob, resolve }));
  const renderer = {
    capabilities: { maxTextureSize: 4096 },
    initRenderTarget(target) {
      target.addEventListener('dispose', () => disposedTargets++);
    },
    copyTextureToTexture(source) {
      uploads.push(source.image);
    },
  };
  const make = (data = manifest, options = {}) => {
    const streamer = createTileStreamer(renderer, data, {
      atlasTiles: 3,
      concurrency: 4,
      lookahead: 0,
      uploadBudget: 2,
      retryDelayMs: 2000,
      ...options,
    });
    streamers.push(streamer);
    return streamer;
  };
  const respond = async (call, ok = true) => {
    call.resolve({ ok, blob: async () => ({ size: 10, url: call.url }) });
    await tick();
  };
  const decode = async (entry) => {
    const bitmap = {
      closes: 0,
      close() {
        this.closes++;
      },
    };
    bitmaps.push(bitmap);
    entry.resolve(bitmap);
    await tick();
    return bitmap;
  };
  try {
    const race = make();
    race.update(0);
    const oldA = calls.at(-1);
    await respond(oldA);
    const oldDecode = decodes.at(-1);
    race.update(1);
    const oldB = calls.at(-1);
    race.update(0);
    const newA = calls.at(-1);
    assert.notEqual(newA, oldA);
    assert.ok(oldA.signal.aborted && oldB.signal.aborted);
    const stale = await decode(oldDecode);
    assert.equal(stale.closes, 1, 'Aborted decode closes its bitmap');
    assert.equal(
      race.stats().pending,
      1,
      'Old completion cannot delete the new request',
    );
    await respond(oldB);
    assert.equal(
      race.stats().failed,
      0,
      'Cancellation does not mark a tile as failed',
    );
    await respond(newA);
    await decode(decodes.at(-1));
    assert.equal(uploads.length, 0, 'Decode callbacks never upload');
    race.setActive(false);
    assert.equal(race.flush(), false, 'Hidden scenes never upload');
    const beforeHidden = calls.length;
    race.update(1);
    assert.equal(calls.length, beforeHidden, 'Hidden scenes never reschedule');
    race.setActive(true);
    race.flush();
    race.flush();
    assert.equal(uploads.length, 1, 'Placement is idempotent');
    assert.deepEqual(race.debug().resident, [[A, 0]]);
    assert.equal(race.debug().slotTile.filter((id) => id === A).length, 1);
    let primed = false;
    void race.prime(0).then(() => {
      primed = true;
    });
    await tick();
    assert.ok(
      primed,
      'Already-resident priming settles without a dirty page table',
    );
    const pendingPrime = race.prime(1);
    race.dispose();
    await pendingPrime;
    await race.prime(0);
    assert.equal(
      disposedTargets,
      1,
      'Disposal settles priming and releases the atlas once',
    );
    race.dispose();
    assert.equal(disposedTargets, 1);
    await respond(calls.at(-1));

    const retry = make();
    retry.update(0);
    await respond(calls.at(-1), false);
    assert.equal(retry.stats().failed, 1);
    const beforeRetry = calls.length;
    retry.update(0);
    assert.equal(calls.length, beforeRetry, 'Failures have a retry delay');
    retry.update(0, performance.now() + 2001);
    assert.equal(
      calls.length,
      beforeRetry + 1,
      'A failed tile can retry in the same bucket',
    );
    await respond(calls.at(-1));
    await decode(decodes.at(-1));
    retry.flush();
    assert.equal(retry.stats().failed, 0);
    assert.equal(retry.stats().resident, 1);

    const batch = make({
      ...manifest,
      buckets: [[A, B, C]],
      floor: [C],
      tiles: 3,
    });
    const beginCalls = calls.length;
    batch.update(0);
    assert.ok(
      calls[beginCalls].url.endsWith('/0-0-0.webp'),
      'Opening bucket is requested before its floor',
    );
    for (const call of calls.slice(beginCalls)) {
      await respond(call);
      await decode(decodes.at(-1));
    }
    const arrays = batch.pageTable.mipmaps.map((mip) => mip.data);
    const beforeUploads = uploads.length;
    batch.flush();
    assert.equal(
      uploads.length - beforeUploads,
      2,
      'Per-frame upload budget is enforced',
    );
    assert.equal(
      batch.debug().publications,
      1,
      'One page-table rebuild per batch',
    );
    batch.flush();
    assert.equal(uploads.length - beforeUploads, 3);
    assert.equal(batch.debug().publications, 2);
    arrays.forEach((array, i) =>
      assert.equal(
        batch.pageTable.mipmaps[i].data,
        array,
        'Page-table arrays are reused',
      ),
    );

    const duringDecode = make();
    duringDecode.update(0);
    await respond(calls.at(-1));
    const late = decodes.at(-1);
    const prime = duringDecode.prime(0);
    duringDecode.dispose();
    await prime;
    assert.equal(
      (await decode(late)).closes,
      1,
      'Decode after disposal releases the bitmap',
    );

    const queued = make();
    queued.update(0);
    await respond(calls.at(-1));
    const queuedBitmap = await decode(decodes.at(-1));
    queued.dispose();
    assert.equal(queuedBitmap.closes, 1, 'Disposal releases queued CPU images');

    const timeout = make();
    await timeout.prime(0, 1);
    assert.equal(
      timeout.stats().resident,
      0,
      'Priming has a bounded timeout without declaring coverage',
    );
    timeout.dispose();
    await respond(calls.at(-1));
    console.log(
      'streamer check: reverse/decode identity, idempotence, visibility, delayed retry, bounded batching, reused tables and prime settlement',
    );
  } finally {
    streamers.forEach((streamer) => streamer.dispose());
    globalThis.fetch = savedFetch;
    globalThis.createImageBitmap = savedDecode;
  }
  bitmaps.forEach((bitmap) =>
    assert.equal(bitmap.closes, 1, 'Each decoded bitmap closes exactly once'),
  );
}
