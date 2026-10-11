// Builds both web LODs and both single-sun backdrops. No external requests from
// Chromium; all source assets are restored by fetch.py and listed in assets.json.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
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
import { suns, lightingParams } from '../../lib/dolores-park-lighting.js';
import { root, startServer, launchBrowser, localPage } from './server.mjs';

const license =
  'Original procedural geometry: CC0-1.0. Poly Haven textures: CC0-1.0. DataSF building footprints and street-tree inventory: PDDL-1.0. USGS 3DEP and USDA NAIP: U.S. public domain. OSM-derived road and footprint geometry: ODbL-1.0, © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. Mapzen/Terrarium ridge: public-domain elevation sources. Car is separate and excluded.';
const source =
  'https://polyhaven.com/; https://data.sfgov.org/; https://www.usgs.gov/3d-elevation-program; https://naip-usdaonline.hub.arcgis.com/; https://www.openstreetmap.org/copyright; see scripts/dolores-park/assets.json and README.md for provenance.';
const args = new Set(process.argv.slice(2));
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
  variants: {},
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
        pattern: /^(?!.*(?:asphalt_02_diff|bark_platanus_diff)).*$/,
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
      draco({
        method: 'edgebreaker',
        quantizePosition: 16,
        quantizeNormal: 10,
        quantizeTexcoord: 12,
      }),
    );
    const out = path.join(root, `public/models/dolores-park${suffix}.glb`);
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
    if (!args.has('--no-backdrops')) {
      for (const summer of [false, true]) {
        if (summer) {
          for (const [key, value] of Object.entries(
            lightingParams(suns.summer),
          ))
            params.set(key, String(value));
          await page.goto(
            `${origin}/scripts/dolores-park/scene.html?${params}`,
          );
          await page.waitForFunction(() => window.done, null, {
            timeout: 300000,
          });
          const err = await page.evaluate(() => window.error);
          if (err) throw Error(err);
        }
        const faces = await page.evaluate(
          (size) => window.captureBackdrop(size),
          phone ? 768 : 1536,
        );
        let total = 0;
        for (const [face, png] of Object.entries(faces)) {
          const file = path.join(
            root,
            `public/scenery/dolores-sky${summer ? '-summer' : ''}${suffix}-${face}.webp`,
          );
          // Captured image-cubemap faces need a vertical flip for WebGL cube lookup.
          await sharp(Buffer.from(png.split(',')[1], 'base64'))
            .flip()
            .flop()
            .webp({ quality: phone ? 74 : 84, effort: 6 })
            .toFile(file);
          total += (await stat(file)).size;
        }
        report.variants[phone ? 'phone' : 'desktop'][
          summer ? 'summerBackdropBytes' : 'backdropBytes'
        ] = total;
      }
    }
    console.log(out, glb.length, 'bytes');
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
