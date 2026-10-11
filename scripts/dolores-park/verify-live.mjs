// End-to-end delivery checks, including real GPU completion rather than just
// timing the JavaScript call to renderer.render(). Run after export.mjs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, startServer, launchBrowser, localPage } from './server.mjs';

const { server, origin } = await startServer(),
  browser = await launchBrowser();
const report = { date: new Date().toISOString(), variants: {} };
try {
  for (const phone of [false, true]) {
    const name = phone ? 'phone' : 'desktop';
    const width = phone ? 390 : 950,
      height = phone ? 292.5 : 593.75;
    const bytes = await readFile(
      path.join(root, `public/models/dolores-park${phone ? '-phone' : ''}.glb`),
    );
    const json = JSON.parse(
      bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
    );
    assert.match(json.asset.copyright, /CC0.*PDDL.*public domain.*ODbL/s);
    assert.match(json.extras.license, /ODbL-1.0/);
    assert.match(json.extras.source, /openstreetmap/);
    assert.ok(json.extensionsUsed.includes('EXT_texture_webp'));
    assert.ok(json.extensionsUsed.includes('KHR_draco_mesh_compression'));
    const page = await localPage(browser, origin, { deviceScaleFactor: 2 });
    const failures = [],
      requests = [];
    page.on('pageerror', (e) => failures.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(
      `${origin}/scripts/dolores-park/live.html?phone=${+phone}&sun=evening&w=${width}&h=${height}&dpr=2&scrollFriendly=1`,
    );
    await page.waitForFunction(() => window.done, null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => window.error), undefined);
    // Let initial controls/resize events settle, then require a genuinely idle renderer.
    await page.waitForTimeout(600);
    const frames = await page.evaluate(
      () => window.doloresViewer.renderedFrames,
    );
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => window.doloresViewer.renderedFrames),
      frames,
      'idle viewer must stop rendering',
    );
    const collisions = await page.evaluate(() => {
      const v = window.doloresViewer,
        target = v.controls.target.clone(),
        saved = v.camera.position.clone();
      const failures = [];
      let spheres = [];
      v.scene.traverse((o) => {
        if (o.userData.dolores)
          spheres = o.userData.dolores.cameraSpheres || [];
      });
      let minClearance = Infinity,
        maxDistance = 0,
        minObstacle = Infinity;
      for (const elevation of [-0.5, 0.5, 2, 5, 7])
        for (let i = 0; i < 360; i += 2) {
          const angle = (i / 180) * Math.PI;
          v.camera.position.set(
            target.x + 9 * Math.sin(angle),
            target.y + elevation,
            target.z + 9 * Math.cos(angle),
          );
          v.constrainCamera();
          const p = v.camera.position,
            clearance = p.y - v.groundAt(p.x, -p.z),
            distance = p.distanceTo(target);
          minClearance = Math.min(minClearance, clearance);
          maxDistance = Math.max(maxDistance, distance);
          if (clearance < 0.4499 || distance > 9.0001 || distance < 3.9999)
            failures.push({ i, elevation, clearance, distance });
          for (const sphere of spheres) {
            const gap =
              Math.hypot(p.x - sphere[0], p.y - sphere[1], p.z - sphere[2]) -
              sphere[3];
            if (gap < -0.001) failures.push({ i, elevation, sphereGap: gap });
          }
          for (const o of window.liveInfo.orbit.obstacles) {
            if (p.y > v.groundAt(o.x, o.y) + o.top) continue;
            const gap = Math.hypot(p.x - o.x, -p.z - o.y) - o.r;
            minObstacle = Math.min(minObstacle, gap);
            if (gap < -0.001)
              failures.push({ i, elevation, obstacle: o.name, gap });
          }
        }
      v.camera.position.copy(saved);
      v.controls.update();
      v.render();
      return { samples: 900, minClearance, maxDistance, minObstacle, failures };
    });
    assert.deepEqual(
      collisions.failures,
      [],
      'camera ground/distance/keep-out constraints',
    );
    const info = await page.evaluate(() => window.doloresViewer.benchmark());
    const gpu = await page.evaluate(() => {
      const gl = window.doloresViewer.renderer.getContext(),
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
      };
    });
    const limits = phone
      ? { bytes: 3e6, triangles: 400000, calls: 60, memory: 64e6, shadow: 1024 }
      : {
          bytes: 6e6,
          triangles: 900000,
          calls: 120,
          memory: 160e6,
          shadow: 2048,
        };
    assert.ok(
      info.downloadBytes <= limits.bytes,
      `${name} download ${info.downloadBytes}`,
    );
    assert.ok(
      info.triangles <= limits.triangles,
      `${name} triangles ${info.triangles}`,
    );
    assert.ok(
      info.drawCalls <= limits.calls,
      `${name} calls ${info.drawCalls}`,
    );
    assert.ok(
      info.orbitMaxDrawCalls <= limits.calls,
      `${name} orbit calls ${info.orbitMaxDrawCalls}`,
    );
    assert.ok(
      info.textures.bytes <= limits.memory,
      `${name} memory ${info.textures.bytes}`,
    );
    assert.equal(info.shadowMap, limits.shadow);
    if (!phone)
      assert.ok(
        info.frameTimeMs <= 8,
        `desktop completed-frame time ${info.frameTimeMs} ms`,
      );
    assert.ok(
      !requests.some((url) => url.includes('/archive/')),
      'viewer must only load delivery assets',
    );
    assert.deepEqual(failures, []);
    // Exercise real input, then explicit disposal. No RAF may survive it.
    await page.mouse.move(width * 0.45, height * 0.5);
    await page.mouse.down();
    await page.mouse.move(width * 0.7, height * 0.52, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    assert.ok(
      (await page.evaluate(() => window.doloresViewer.renderedFrames)) > frames,
    );
    await page.evaluate(() => {
      window.previousViewer = window.doloresViewer;
      window.previousViewer.renderer.forceContextLoss();
    });
    await page.waitForFunction(() =>
      document.querySelector('#hint').textContent.includes('paused'),
    );
    await page.evaluate(() =>
      window.previousViewer.renderer.forceContextRestore(),
    );
    await page.waitForFunction(
      () => window.done && window.doloresViewer !== window.previousViewer,
      null,
      { timeout: 30000 },
    );
    assert.equal(await page.evaluate(() => window.error), undefined);
    assert.equal(await page.locator('canvas').count(), 1);
    await page.evaluate(() => window.doloresViewer.dispose());
    assert.equal(await page.locator('canvas').count(), 0);
    report.variants[name] = {
      ...info,
      gpu,
      collisions,
      idleRenderingPassed: true,
      contextRecoveryPassed: true,
      disposalPassed: true,
    };
    console.log(
      name,
      JSON.stringify({
        download: info.downloadBytes,
        triangles: info.triangles,
        calls: info.drawCalls,
        textureBytes: info.textures.bytes,
        medianMs: info.frameTimeMs,
      }),
    );
    await page.close();
  }
  await writeFile(
    path.join(root, 'scripts/dolores-park/live-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
} finally {
  await browser.close();
  server.close();
}
