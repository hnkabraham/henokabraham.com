import type { Box2, Texture, Vector2, WebGLRenderer } from 'three';

// About 8 MB of pixels per strip: 512 rows of a 4096-wide texture.
const STRIP_BYTES = 8 * 1024 * 1024;

/**
 * Uploads large decoded textures to the GPU ahead of their first draw, a
 * strip of rows at a time in idle moments, instead of all at once inside
 * the frame that first shows them.
 *
 * A 4096² texture takes about 100 ms to upload in Chromium whatever the
 * source (ImageBitmap, image element or raw bytes): the cost is moving
 * 64 MB, and it scales with the rows sent. So the tour's three aircraft
 * maps, uploaded on the first frame that drew the aircraft, stalled the
 * start of every first scroll for about a third of a second. In 512-row
 * strips each piece takes about 15 ms in Chromium and 20 ms in WebKit.
 *
 * The texture's storage is allocated without data (`source.dataReady`
 * false), each strip is copied in with `copyTextureToTexture`, and the
 * mipmaps are generated with the last one. Only ImageBitmap sources are
 * handled: their decode options fix their colour handling, so a strip
 * matches a whole upload exactly. Other textures keep three.js's own
 * upload.
 *
 * `finish()` uploads whatever is left at once; call it before a frame that
 * draws the textures, so none is ever drawn half uploaded. `cancel()`
 * stops the idle work.
 */
export function uploadAhead(
  T: { Box2: typeof Box2; Texture: typeof Texture; Vector2: typeof Vector2 },
  renderer: WebGLRenderer,
  textures: Iterable<Texture>,
) {
  const jobs: { texture: Texture; image: ImageBitmap; next: number }[] = [];
  for (const texture of textures) {
    const image = texture.image as unknown;
    if (
      typeof ImageBitmap === 'undefined' ||
      !(image instanceof ImageBitmap) ||
      texture.flipY ||
      image.width * image.height * 4 <= STRIP_BYTES
    )
      continue;
    jobs.push({ texture, image, next: 0 });
  }
  if (!jobs.length) return { pending: false, finish() {}, cancel() {} };
  // Never handed to the renderer itself, so copyTextureToTexture reads its
  // image directly rather than from the GPU.
  const source = new T.Texture(),
    region = new T.Box2(),
    at = new T.Vector2();
  const step = () => {
    const job = jobs[0];
    if (!job) return;
    const { texture, image } = job,
      rows = Math.max(64, Math.floor(STRIP_BYTES / (image.width * 4))),
      top = job.next,
      bottom = Math.min(image.height, top + rows),
      last = bottom === image.height,
      mipmaps = texture.generateMipmaps;
    // The first strip allocates the whole mip chain; only the last needs
    // the mipmaps generated.
    if (top === 0) texture.source.dataReady = false;
    texture.generateMipmaps = mipmaps && (top === 0 || last);
    source.image = image;
    region.min.set(0, top);
    region.max.set(image.width, bottom);
    renderer.copyTextureToTexture(source, texture, region, at.set(0, top));
    texture.generateMipmaps = mipmaps;
    job.next = bottom;
    if (last) {
      // Any later upload (a needsUpdate) sends the data again as usual.
      texture.source.dataReady = true;
      jobs.shift();
    }
  };
  // One strip per idle moment; Safari has no requestIdleCallback.
  const idle = typeof requestIdleCallback === 'function';
  let handle = 0;
  const schedule = () => {
    handle = idle
      ? requestIdleCallback(pump, { timeout: 1000 })
      : window.setTimeout(pump, 16);
  };
  const pump = () => {
    handle = 0;
    step();
    if (jobs.length) schedule();
  };
  const cancel = () => {
    if (!handle) return;
    if (idle) cancelIdleCallback(handle);
    else clearTimeout(handle);
    handle = 0;
  };
  schedule();
  return {
    get pending() {
      return jobs.length > 0;
    },
    finish() {
      cancel();
      while (jobs.length) step();
    },
    cancel,
  };
}
