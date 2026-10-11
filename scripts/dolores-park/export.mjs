// Builds both web LODs and all single-sun backdrops. No external requests from
// Chromium; all source assets are restored by fetch.py and listed in assets.json.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  weld,
  prune,
  draco,
  textureCompress,
  simplifyPrimitive,
  compactPrimitive,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import {
  suns,
  backdrops,
  lightingParams,
} from '../../lib/dolores-park-lighting.js';
import { root, startServer, launchBrowser, localPage } from './server.mjs';

const license =
  'Original procedural geometry: CC0-1.0. Poly Haven textures: CC0-1.0. DataSF building footprints and street-tree inventory: PDDL-1.0. USGS 3DEP and USDA NAIP: U.S. public domain. OSM-derived road and footprint geometry: ODbL-1.0, © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. Mapzen/Terrarium ridge: public-domain elevation sources. Car is separate and excluded.';
const source =
  'https://polyhaven.com/; https://data.sf.gov/; https://www.usgs.gov/3d-elevation-program; https://naip-usdaonline.hub.arcgis.com/; https://www.openstreetmap.org/copyright; see scripts/dolores-park/assets.json and README.md for provenance.';
const args = new Set(process.argv.slice(2));
// The far field after dark: no sun, a trace of sky light, and the windows
// live-build.js lights. The viewer darkens nothing further at night.
const NIGHT_BAKE = { exposure: 1.2, env: 0.05, hemi: 0.1 };
// Two captures of a face over a transparent sky, with black and with white
// fog (live-build.js captureBand): their difference is the fog amount per
// pixel. Store the black-fog capture premultiplied by its coverage, which is
// exactly the unfogged surface times what of it the fog leaves, and fold
// coverage and that remainder into alpha. The viewer composites it over its
// own sky as sky * (1 - alpha) + colour.
async function bandFace(black, white) {
  const decode = (url) =>
    sharp(Buffer.from(url.split(',')[1], 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  const [b, w] = await Promise.all([decode(black), decode(white)]);
  const { width, height } = b.info,
    out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const fog = Math.min(
      1,
      Math.max(
        0,
        (w.data[i] +
          w.data[i + 1] +
          w.data[i + 2] -
          b.data[i] -
          b.data[i + 1] -
          b.data[i + 2]) /
          765,
      ),
    );
    const coverage = b.data[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      out[i + c] = Math.round(b.data[i + c] * coverage);
    out[i + 3] = Math.round(b.data[i + 3] * (1 - fog));
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}
const { server, origin } = await startServer(),
  browser = await launchBrowser();
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
await MeshoptSimplifier.ready;
await mkdir(path.join(root, 'public/scenery'), { recursive: true });
const report = {
  generated: new Date().toISOString(),
  splitDistance: 180,
  variants: args.has('--backdrops-only')
    ? JSON.parse(
        await readFile(
          path.join(root, 'scripts/dolores-park/export-report.json'),
          'utf8',
        ),
      ).variants
    : {},
};
try {
  for (const phone of [false, true]) {
    if (args.has('--desktop-only') && phone) continue;
    const suffix = phone ? '-phone' : '';
    const page = await localPage(browser, origin);
    const params = new URLSearchParams({
      profile: 'live',
      preset: 'streetview',
      phone: String(+phone),
      cam: '8,-161',
      camH: '1.2',
      look: '12.9,-154.63,1.05',
      fov: '52',
      w: '1600',
      h: '1000',
    });
    await page.goto(`${origin}/scripts/dolores-park/scene.html?${params}`);
    await page.waitForFunction(() => window.done, null, { timeout: 300000 });
    const error = await page.evaluate(() => window.error);
    if (error) throw Error(error);
    // --backdrops-only rebakes the backdrops and leaves both GLBs alone.
    if (!args.has('--backdrops-only')) {
      console.log('Exporting', phone ? 'phone' : 'desktop');
      const length = await page.evaluate(() => window.exportPark());
      console.log('Raw bytes', length);
      const bytes = Buffer.alloc(length);
      for (let offset = 0; offset < length; offset += 8 * 1024 * 1024) {
        const encoded = await page.evaluate(
          (offset) =>
            new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(
                new Blob([
                  window.parkBytes.subarray(offset, offset + 8 * 1024 * 1024),
                ]),
              );
            }),
          offset,
        );
        Buffer.from(encoded, 'base64').copy(bytes, offset);
      }
      const document = await io.readBinary(new Uint8Array(bytes));
      // Three names texture definitions; glTF Transform names image resources.
      // Copy that identity across before name-based texture budgets are applied.
      const rawJSON = JSON.parse(
        bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
      );
      for (const texture of rawJSON.textures || []) {
        if (texture.name && texture.source !== undefined)
          document
            .getRoot()
            .listTextures()
            [texture.source].setName(texture.name);
      }
      document
        .getRoot()
        .listTextures()
        .forEach((texture, i) => {
          if (!texture.getName()) texture.setName(`Dolores texture ${i}`);
        });
      document.getRoot().getAsset().copyright = license;
      document.getRoot().setExtras({
        license,
        source,
        attribution:
          '© OpenStreetMap contributors — ODbL 1.0 — https://www.openstreetmap.org/copyright',
        profile: phone ? 'phone' : 'desktop',
      });
      await document.transform(dedup({ keepUniqueNames: true }), weld());
      for (const mesh of document.getRoot().listMeshes())
        for (const prim of mesh.listPrimitives()) {
          compactPrimitive(prim);
          const name = prim.getMaterial()?.getName() || '';
          if (!/canopy|leaves|fronds|palm-dead/i.test(name))
            simplifyPrimitive(prim, {
              simplifier: MeshoptSimplifier,
              ratio: phone ? 0.4 : 0.8,
              error: phone ? 0.0015 : 0.0004,
              lockBorder: true,
            });
        }
      await document.transform(
        prune({ keepExtras: true }),
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: [512, 512],
          // The matcher tests both name and URI; do not match an empty URI or
          // it would bypass the exclusions on named embedded textures.
          pattern:
            /^(?!.*(?:asphalt_02_diff|bark_platanus_diff|palm-frond-alpha)).+$/,
          quality: phone ? 68 : 78,
          effort: 80,
        }),
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: phone ? [512, 512] : [1024, 1024],
          pattern: /(?:asphalt_02_diff|bark_platanus_diff)/,
          quality: phone ? 68 : 78,
          effort: 80,
        }),
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: phone ? [640, 640] : [1024, 1024],
          pattern: /palm-frond-alpha/,
          quality: 88,
          effort: 80,
        }),
        ...(phone
          ? [
              textureCompress({
                encoder: sharp,
                targetFormat: 'webp',
                resize: [256, 256],
                pattern: /bark_platanus_nor|asphalt_02_nor/,
                quality: 68,
                effort: 80,
              }),
            ]
          : []),
        draco({
          method: 'edgebreaker',
          quantizePosition: 16,
          quantizeNormal: 10,
          quantizeTexcoord: 12,
        }),
      );
      const out = path.join(root, `public/models/dolores-park${suffix}.glb`);
      // The 0.25 m collision tile repeats whole road rows. Losslessly pack its
      // existing 0.1 mm samples instead of spending >130 KB on JSON numbers.
      for (const node of document.getRoot().listNodes()) {
        const extras = node.getExtras(),
          ground = extras.dolores?.ground;
        if (!ground) continue;
        const packed = Buffer.alloc(ground.heights.length * 4);
        ground.heights.forEach((h, i) =>
          packed.writeInt32LE(Math.round(h * 10000), i * 4),
        );
        ground.heightsGzip = gzipSync(packed, { level: 9 }).toString('base64');
        delete ground.heights;
        node.setExtras(extras);
      }
      await io.write(out, document);
      const glb = await readFile(out),
        json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
      assert.match(json.asset.copyright, /CC0.*PDDL.*public domain.*ODbL/s);
      assert.match(json.extras.license, /ODbL-1.0/);
      assert.match(json.extras.source, /openstreetmap/);
      assert.ok(json.extensionsUsed.includes('KHR_draco_mesh_compression'));
      assert.ok(json.extensionsUsed.includes('EXT_texture_webp'));
      const roundTrip = await page.evaluate(() => window.roundTrip);
      report.variants[phone ? 'phone' : 'desktop'] = {
        glbBytes: glb.length,
        roundTrip,
      };
      console.log(out, glb.length, 'bytes');
    }
    if (!args.has('--no-backdrops')) {
      const variant = (report.variants[phone ? 'phone' : 'desktop'] ??= {});
      variant.backdropBytes ??= {};
      // Superseded by the time-of-day backdrops.
      delete variant.eveningBackdropBytes;
      delete variant.summerBackdropBytes;
      const only = process.argv
        .find((a) => a.startsWith('--backdrop='))
        ?.slice(11);
      for (const [name, bake] of Object.entries(backdrops)) {
        if (only && name !== only) continue;
        // Day backdrops take the tuned daylight from another bearing; the
        // night one keeps a sun only for the HDRI's turn, at no strength.
        const light = bake.night
          ? { ...lightingParams(suns.evening), sun: 0, ...NIGHT_BAKE }
          : lightingParams({ ...suns.evening, ...bake });
        light.sunAz = bake.azimuth;
        light.sunEl = bake.night ? 30 : bake.elevation;
        for (const [key, value] of Object.entries(light))
          params.set(key, String(value));
        if (bake.night) params.set('night', '1');
        else params.delete('night');
        await page.goto(`${origin}/scripts/dolores-park/scene.html?${params}`);
        await page.waitForFunction(() => window.done, null, {
          timeout: 300000,
        });
        const err = await page.evaluate(() => window.error);
        if (err) throw Error(err);
        const faces = await page.evaluate(
          (size) => window.captureBand(size),
          phone
            ? { px: 512, nx: 1536, py: 512, ny: 512, pz: 512, nz: 1536 }
            : 1792,
        );
        let total = 0;
        for (const [face, { black, white }] of Object.entries(faces)) {
          const file = path.join(
            root,
            `public/scenery/dolores-band-${name}${suffix}-${face}.webp`,
          );
          // Captured image-cubemap faces need a vertical flip for WebGL cube lookup.
          await (
            await bandFace(black, white)
          )
            .flip()
            .flop()
            .webp({
              quality: phone ? (face === 'nz' || face === 'nx' ? 85 : 63) : 86,
              // Lossy alpha keeps the phone under its 3 MB download.
              alphaQuality: phone ? 80 : 100,
              effort: 6,
            })
            .toFile(file);
          total += (await stat(file)).size;
        }
        variant.backdropBytes[name] = total;
      }
    }
    await page.close();
  }
  await writeFile(
    path.join(root, 'scripts/dolores-park/export-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
} finally {
  await browser.close();
  server.close();
}
