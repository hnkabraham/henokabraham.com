import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as T from 'three';
import {
  createSourceFile,
  ScriptTarget,
  ScriptKind,
  isVariableDeclaration,
  isFunctionDeclaration,
  isBinaryExpression,
  transpileModule,
} from 'typescript';

export async function checkBayLifecycle() {
  const source = await fs.readFile(
    new URL('../app/bay-flight-scene.tsx', import.meta.url),
    'utf8',
  );
  const ast = createSourceFile(
    'scene.tsx',
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.TSX,
  );
  const declarations = new Map();
  const functions = new Map();
  let cleanup;
  const visit = (node) => {
    if (isVariableDeclaration(node))
      declarations.set(node.name.getText(ast), node);
    if (isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node);
    if (
      isBinaryExpression(node) &&
      node.left.getText(ast) === 'cleanup' &&
      node.right.getText(ast).startsWith('() =>')
    )
      cleanup = node;
    node.forEachChild(visit);
  };
  visit(ast);
  assert.ok(cleanup);
  const names = [
    'geometries',
    'materials',
    'textures',
    'instances',
    'tiles',
    'lazyTimer',
    'pendingUploads',
    'environment',
  ];
  for (const name of names) {
    assert.ok(
      declarations.get(name).getStart(ast) < cleanup.getStart(ast),
      `${name} initialized before cleanup registration`,
    );
  }
  const handles = names
    .map((name) => `let ${declarations.get(name).getText(ast)};`)
    .join('\n');
  const body = transpileModule(
    `${handles}
    let disposed = false;
    ${functions.get('disposeObject').getText(ast)}
    const cleanup = ${cleanup.right.getText(ast)};
    if (hasTiles) tiles = tileOwner;
    lazyTimer = timer;
    cleanup(); cleanup();
  `,
    { compilerOptions: { target: ScriptTarget.ES2022 } },
  ).outputText;
  for (const stage of [
    'assets',
    'atmosphere',
    'priming',
    'compilation',
    'ready',
  ]) {
    const counts = {
      instance: 0,
      renderer: 0,
      tiles: 0,
      geometry: 0,
      material: 0,
      abort: 0,
      timer: 0,
    };
    const scene = new T.Scene();
    const mesh = new T.InstancedMesh(
      new T.BoxGeometry(),
      new T.MeshStandardMaterial(),
      2,
    );
    mesh.addEventListener('dispose', () => counts.instance++);
    mesh.geometry.addEventListener('dispose', () => counts.geometry++);
    mesh.material.addEventListener('dispose', () => counts.material++);
    scene.add(mesh);
    vm.runInNewContext(body, {
      T,
      scene,
      hasTiles: stage !== 'assets',
      timer: stage === 'ready' ? 7 : undefined,
      tileOwner: {
        dispose() {
          counts.tiles++;
        },
      },
      abort: {
        abort() {
          counts.abort++;
        },
      },
      clearTimeout() {
        counts.timer++;
      },
      cancelAnimationFrame() {},
      frame: 0,
      eggs: {},
      observer: { disconnect() {} },
      sizeObserver: { disconnect() {} },
      document: { removeEventListener() {} },
      visibilityChange() {},
      contextLost() {},
      latest: { current: { audio: { current: null } } },
      rendering: { dispose() {} },
      renderer: {
        dispose() {
          counts.renderer++;
        },
        domElement: { removeEventListener() {}, remove() {} },
      },
      sun: { shadow: { dispose() {} } },
    });
    assert.deepEqual(
      counts,
      {
        instance: 1,
        renderer: 1,
        tiles: stage === 'assets' ? 0 : 1,
        geometry: 1,
        material: 1,
        abort: 1,
        timer: 1,
      },
      `${stage}: complete, idempotent cleanup`,
    );
  }

  // Run the actual animation function with counters for expensive work.
  const counts = {
    update: 0,
    upload: 0,
    texture: 0,
    draw: 0,
    schedule: 0,
  };
  const context = {
    disposed: false,
    frame: 0,
    lastTime: 0,
    priorMeasuredFrame: 0,
    measuredFrames: [],
    recordFlightMetric() {},
    performanceControl: { reset() {} },
    scrollPerformance: { reset() {} },
    visible: false,
    document: { hidden: false },
    latest: {
      current: {
        reducedMotion: true,
        reveal: { current: 1 },
        audio: { current: null },
      },
    },
    renderDirty: true,
    previousP: 1,
    currentP: 1,
    ready: true,
    lazyDue: false,
    lazyStarted: true,
    requestAnimationFrame() {
      return 1;
    },
    tiles: {
      update() {
        counts.schedule++;
      },
      flush() {
        counts.upload++;
        return false;
      },
    },
    update() {
      counts.update++;
    },
    uploadPendingTexture() {
      counts.texture++;
      return false;
    },
    draw() {
      counts.draw++;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    transpileModule(functions.get('animate').getText(ast), {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  vm.runInContext('animate(1000)', context);
  assert.deepEqual(
    counts,
    { update: 0, upload: 0, texture: 0, draw: 0, schedule: 0 },
    'Offscreen work is suspended',
  );
  context.visible = true;
  context.latest.current.reveal.current = 0;
  vm.runInContext('animate(1008)', context);
  assert.deepEqual(
    counts,
    { update: 0, upload: 0, texture: 0, draw: 0, schedule: 0 },
    'The sky opening does not render or upload the covered 3D scene',
  );
  context.latest.current.reveal.current = 1;
  vm.runInContext('animate(1016); animate(1032)', context);
  assert.equal(
    counts.draw,
    1,
    'Reduced motion draws only the invalidated frame',
  );
  assert.equal(counts.update, 1);
  context.renderDirty = true;
  vm.runInContext('animate(1048)', context);
  assert.equal(counts.draw, 2, 'Late assets invalidate reduced motion');
  context.document.hidden = true;
  vm.runInContext('animate(1064)', context);
  assert.equal(
    counts.upload,
    3,
    'A hidden document performs no additional tile work',
  );
  assert.equal(
    counts.texture,
    3,
    'Lazy texture uploads follow the same visible-frame gating',
  );
  console.log(
    'lifecycle check: actual cleanup at five startup stages, instance disposal, hidden-frame gating of tile and texture uploads, and reduced-motion invalidation',
  );
}
