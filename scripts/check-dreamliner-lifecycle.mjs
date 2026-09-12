// Exercise the real React effect with a fake WebGL boundary. In particular,
// a model parser or HDR request can complete after the user leaves the scene.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import * as THREE from 'three';
const uri = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const source = await fs.readFile(
  new URL('../app/dreamliner-scene.tsx', import.meta.url),
  'utf8',
);
const js = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX },
}).outputText;
const pure = async (p) =>
  uri(
    transpileModule(await fs.readFile(new URL(p, import.meta.url), 'utf8'), {
      compilerOptions: { module: ModuleKind.ESNext },
    }).outputText,
  );
const refs = [];
const hooks = {
  useRef: (initial) => {
    const r = {
      current: initial === null ? globalThis.tourHarness.host : initial,
    };
    refs.push(r);
    return r;
  },
  useEffect: (effect) => globalThis.tourHarness.effects.push(effect),
};
const mock = uri(
  'export const useRef=(v)=>globalThis.tourHooks.useRef(v);export const useEffect=(f)=>globalThis.tourHooks.useEffect(f);',
);
const imports = {
  react: mock,
  'react/jsx-runtime': uri('export const jsx=()=>null;'),
  three: uri(
    `const t=globalThis.tourHarness.three;${Object.keys(THREE)
      .map((k) => `export const ${k}=t.${k};`)
      .join('')}`,
  ),
  'three/addons/loaders/GLTFLoader.js': uri(
    'export class GLTFLoader { parseAsync(){return globalThis.tourHarness.parse.promise;} }',
  ),
  'three/addons/loaders/HDRLoader.js': uri(
    'export class HDRLoader { parse(){return {data:new Uint16Array(4),width:1,height:1,type:1016};} }',
  ),
  '@/lib/scene-assets': uri('export const sceneAsset=p=>p;'),
  '@/lib/dreamliner-tour': await pure('../lib/dreamliner-tour.ts'),
  '@/lib/bay-performance': await pure('../lib/bay-performance.ts'),
  '@/lib/airframe-flex': uri('export const addWingFlex=()=>{};'),
  '@/lib/bay-livery': uri(
    'export const addLivery=()=>{};export const createLiveryTexture=()=>null;',
  ),
  '@/lib/flight-metrics': uri('export const recordFlightMetric=()=>{};'),
};
let code = js;
for (const [key, value] of Object.entries(imports))
  code = code
    .replaceAll(`'${key}'`, `'${value}'`)
    .replaceAll(`"${key}"`, `"${value}"`);
globalThis.tourHooks = hooks;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise(setImmediate);
};
const saved = new Map();
function install(k, v) {
  if (!saved.has(k)) saved.set(k, globalThis[k]);
  globalThis[k] = v;
}
const frames = new Map();
let frameID = 0;
install('devicePixelRatio', 2);
install('requestAnimationFrame', (fn) => {
  frames.set(++frameID, fn);
  return frameID;
});
install('cancelAnimationFrame', (id) => frames.delete(id));
const windowEvents = new EventTarget();
const documentEvents = new EventTarget();
install('addEventListener', windowEvents.addEventListener.bind(windowEvents));
install(
  'removeEventListener',
  windowEvents.removeEventListener.bind(windowEvents),
);
install('document', {
  hidden: false,
  addEventListener: documentEvents.addEventListener.bind(documentEvents),
  removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
});
install(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);
install(
  'IntersectionObserver',
  class {
    observe() {}
    disconnect() {}
  },
);
let constructed = 0,
  draws = 0,
  released = 0;
const canvas = {
  addEventListener() {},
  removeEventListener() {},
  remove() {},
  classList: { add() {} },
};
class Renderer {
  constructor() {
    constructed++;
    this.domElement = canvas;
    this.shadowMap = {};
    this.capabilities = { getMaxAnisotropy: () => 8 };
    this.info = { render: { triangles: 0, calls: 0 } };
  }
  setClearColor() {}
  setPixelRatio(r) {
    this.ratio = r;
  }
  getPixelRatio() {
    return this.ratio;
  }
  setSize() {}
  compile() {}
  render() {
    draws++;
  }
  dispose() {
    released++;
  }
}
class PMREM {
  fromEquirectangular() {
    return { texture: new THREE.Texture(), dispose() {} };
  }
  dispose() {}
}
const makeHarness = () => ({
  host: { dataset: {}, clientWidth: 390, clientHeight: 844, appendChild() {} },
  effects: [],
  parse: deferred(),
  modelFetch: deferred(),
  hdrFetch: deferred(),
  three: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM },
});
const tick = (now) => {
  const work = [...frames.values()];
  frames.clear();
  work.forEach((f) => f(now));
};
try {
  const { default: Scene } = await import(uri(code));
  for (const mode of ['reduced', 'unmount-fetch', 'unmount-parse', 'active']) {
    constructed = draws = released = 0;
    frames.clear();
    const h = (globalThis.tourHarness = makeHarness());
    install('fetch', (path) =>
      path.includes('.hdr') ? h.hdrFetch.promise : h.modelFetch.promise,
    );
    const statuses = [];
    const progress = { current: 0 };
    Scene({
      progress,
      reducedMotion: mode === 'reduced',
      audio: { current: null },
      onStatus: (s) => statuses.push(s),
    });
    const disposers = h.effects.map((f) => f()).filter(Boolean);
    const unmount = () => disposers.forEach((f) => f());
    await flush();
    if (mode === 'reduced') {
      assert.equal(constructed, 0);
      assert.deepEqual(statuses, ['ready']);
      continue;
    }
    assert.equal(constructed, 1);
    if (mode === 'unmount-fetch') unmount();
    h.modelFetch.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await flush();
    if (mode === 'unmount-parse') unmount();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    let freedGeometry = 0,
      freedMaterial = 0;
    geometry.addEventListener('dispose', () => freedGeometry++);
    material.addEventListener('dispose', () => freedMaterial++);
    const model = new THREE.Group();
    model.add(new THREE.Mesh(geometry, material));
    h.parse.resolve({ scene: model });
    h.hdrFetch.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await flush();
    if (mode === 'unmount-fetch') {
      assert.equal(released, 1);
      assert.deepEqual(statuses, ['loading']);
      continue;
    }
    if (mode === 'unmount-parse') {
      assert.equal(freedGeometry, 1);
      assert.equal(freedMaterial, 1);
      assert.equal(released, 1);
      assert.deepEqual(statuses, ['loading']);
      continue;
    }
    assert.deepEqual(statuses, ['loading', 'ready']);
    tick(100);
    tick(116);
    assert.equal(draws, 0, 'Settled opening does not render the aircraft');
    assert.equal(frames.size, 0, 'Settled opening does not spin a RAF loop');
    // Reproduce the ordering where the renderer's RAF precedes the parent’s
    // progress update. One extra frame must pick up that very first scroll.
    windowEvents.dispatchEvent(new Event('scroll'));
    tick(200);
    progress.current = 0.12;
    tick(216);
    assert.ok(frames.size > 0, 'The progress ref is picked up on the next frame');
    tick(232);
    tick(248);
    assert.ok(draws > 0, 'The first scroll wakes a settled opening');
    document.hidden = true;
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size, 0, 'Hidden documents stop all scheduled draws');
    document.hidden = false;
    unmount();
    assert.equal(freedGeometry, 1);
    assert.equal(freedMaterial, 1);
    assert.equal(released, 1);
    assert.equal(frames.size, 0);
  }
  console.log(
    'Passed: reduced motion skips WebGL; unmount during fetch and parsing; late HDR completion; opening has no draws or idle RAF; first-scroll wake ordering; hidden-document suspension; resources disposed once.',
  );
} finally {
  for (const [k, v] of saved) globalThis[k] = v;
  delete globalThis.tourHarness;
  delete globalThis.tourHooks;
}
