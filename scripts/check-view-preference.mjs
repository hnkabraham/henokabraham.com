// Exercise the production hook's store without a DOM renderer, including
// the server snapshot that keeps lazy WebGL scenes out of the first render.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
const source = await fs.readFile(
  new URL('../app/use-view-preference.ts', import.meta.url),
  'utf8',
);
const uri = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const mock = uri(
  `export const useSyncExternalStore=(...args)=>globalThis.viewTest.store(...args);export const useRef=()=>globalThis.viewTest.anchor;export const useLayoutEffect=(fn)=>{globalThis.viewTest.layout=fn;};`,
);
const compiled = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext },
}).outputText.replaceAll("from 'react'", `from '${mock}'`);
const saved = new Map();
const install = (key, value) => {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
};
let moduleId = 0;
try {
  for (const scenario of [
    'normal',
    'saved-simple',
    'system-reduced',
    'metered',
    'slow-network',
    'blocked-storage',
    'invalid-choice',
  ]) {
    const media = new EventTarget();
    media.matches = scenario === 'system-reduced';
    const network = new EventTarget();
    network.saveData = scenario === 'metered';
    network.effectiveType = scenario === 'slow-network' ? '2g' : '4g';
    const events = new EventTarget();
    let value =
      scenario === 'saved-simple'
        ? 'simple'
        : scenario === 'invalid-choice'
          ? 'unknown'
          : null;
    install('localStorage', {
      getItem: () => {
        if (scenario === 'blocked-storage') throw Error('blocked');
        return value;
      },
      setItem: (_key, next) => {
        if (scenario === 'blocked-storage') throw Error('blocked');
        value = next;
      },
    });
    install('matchMedia', () => media);
    install('navigator', { connection: network });
    install('addEventListener', events.addEventListener.bind(events));
    install('removeEventListener', events.removeEventListener.bind(events));
    let top = -120,
      scrollResult;
    const section = {
      id: 'about',
      getBoundingClientRect: () => ({ top, bottom: 500 }),
    };
    install('document', {
      documentElement: { dataset: {} },
      querySelectorAll: () => [section],
      getElementById: () => section,
    });
    install('scrollY', 4200);
    install('scrollTo', (options) => {
      scrollResult = options;
    });
    const harness = {
      anchor: { current: null },
      server: true,
      notify: 0,
      store(subscribe, read, server) {
        this.read = read;
        this.subscribe = subscribe;
        return this.server ? server() : read();
      },
    };
    install('viewTest', harness);
    const { useViewPreference: renderPreference } = await import(
      uri(compiled + `\n// fresh module ${moduleId++}`)
    );
    let state = renderPreference();
    assert.equal(
      state.simple,
      true,
      'Server/hydration cannot mount either scene',
    );
    assert.equal(state.ready, false);
    harness.server = false;
    state = renderPreference();
    assert.equal(state.ready, true);
    const automatic = [
      'saved-simple',
      'system-reduced',
      'metered',
      'slow-network',
    ].includes(scenario);
    assert.equal(state.simple, automatic, scenario);
    const cleanup = harness.subscribe(() => harness.notify++);
    state.toggle();
    top = -3020; // The flight above About collapsed; preserve About's screen position.
    state = renderPreference();
    harness.layout();
    assert.equal(
      state.simple,
      !automatic,
      'Explicit choice works even when storage is blocked',
    );
    assert.equal(
      scrollResult.top,
      1300,
      'Changing mode preserves the lower-section anchor',
    );
    assert.equal(
      document.documentElement.dataset.simpleView,
      String(!automatic),
    );
    if (scenario !== 'blocked-storage')
      assert.equal(value, automatic ? 'full' : 'simple');
    const event = new Event('storage');
    Object.assign(event, { key: 'personal-airspace:view', newValue: 'simple' });
    events.dispatchEvent(event);
    assert.equal(
      renderPreference().simple,
      true,
      'Another tab can change the preference',
    );
    const clear = new Event('storage');
    Object.assign(clear, { key: null, newValue: null });
    events.dispatchEvent(clear);
    media.matches = true;
    media.dispatchEvent(new Event('change'));
    assert.equal(
      renderPreference().simple,
      true,
      'Automatic mode follows the operating system',
    );
    const count = harness.notify;
    cleanup();
    media.dispatchEvent(new Event('change'));
    network.dispatchEvent(new Event('change'));
    events.dispatchEvent(clear);
    assert.equal(harness.notify, count, 'Subscriptions are cleaned up');
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    saved.clear();
  }
  console.log(
    'Passed: static server/hydration, saved choices, reduced motion, data saver, slow networks, blocked storage, invalid choices, explicit overrides, section anchoring, cross-tab sync, and subscription cleanup.',
  );
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
