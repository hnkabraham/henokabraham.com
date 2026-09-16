import type {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
} from 'three';

/**
 * What the shipped GLB leaves out of the GEnx tailpipe. The upstream model's
 * compressor and turbine stacks are omitted (see prepare-dreamliner.py), so
 * a look up the core nozzle found an empty duct behind a cold plug. These
 * build the pieces the runtime adds back, in the model's own metre axes:
 * nose −X, port +Z, up +Y, the engines' axes at y = −1.127, z = ±9.413.
 */

/** Where the last turbine stage sits: the core nozzle, aft of the cone's base. */
export const TURBINE_STATION = -3.15;
/** Just inside the nozzle lip, where the halo of the exhaust glow floats. */
export const EXHAUST_STATION = -2.1;
export const ENGINE_AXIS = { y: -1.12702, z: 9.41336 };

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The wing-flex lift at a model-space point, the same curve `addWingFlex`
 * applies in the vertex shader, for the engine parts that ride on pivots
 * (fans, turbines, exhaust halos) and so cannot take the shader patch
 * without the lift turning with them.
 */
export function wingLift(x: number, z: number, flex: number) {
  const envelope = smooth(-12, -6, x) * (1 - smooth(10, 17, x));
  const span = Math.max(0, Math.abs(z) - 4) / 26;
  return flex * span * span * envelope;
}

/**
 * A ring of low-pressure turbine blades, one flat quad each, staggered like
 * the real stage so their faces catch the eye as the ring turns. It fits the
 * annulus between the exhaust cone (0.53 m here) and the nozzle wall (0.83 m).
 * Vertex colours shade the blades, tips brighter than roots with a faint
 * per-blade variation, so the ring reads as turning rather than a static
 * disc; the material supplies the metal and the ember.
 */
export function turbineRing(T: {
  BufferGeometry: typeof BufferGeometry;
  BufferAttribute: typeof BufferAttribute;
}) {
  const blades = 44,
    inner = 0.56,
    outer = 0.8,
    chord = 0.17,
    stagger = 0.75;
  const positions: number[] = [],
    colors: number[] = [],
    index: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const radial = [Math.cos(a), Math.sin(a)];
    const tangent = [-Math.sin(a), Math.cos(a)];
    const along = [
      Math.cos(stagger),
      tangent[0] * Math.sin(stagger),
      tangent[1] * Math.sin(stagger),
    ];
    const variation = 0.82 + 0.18 * (((i * 7) % 5) / 4);
    for (const [r, u] of [
      [inner, -1],
      [inner, 1],
      [outer, 1],
      [outer, -1],
    ]) {
      positions.push(
        along[0] * u * (chord / 2),
        radial[0] * r + along[1] * u * (chord / 2),
        radial[1] * r + along[2] * u * (chord / 2),
      );
      const tone = variation * (r === inner ? 0.6 : 1);
      colors.push(tone, tone, tone);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    'color',
    new T.BufferAttribute(new Float32Array(colors), 3),
  );
  geometry.setIndex(index);
  return geometry;
}

/**
 * A soft radial falloff for the exhaust halo: a bright core inside a wide,
 * faint skirt, white so the sprite's colour sets the hue. Built as pixel
 * data rather than a canvas so it needs no DOM.
 */
export function glowDisc(T: {
  DataTexture: typeof DataTexture;
  LinearFilter: typeof LinearFilter;
}) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1,
        dy = ((y + 0.5) / size) * 2 - 1;
      const d = Math.hypot(dx, dy);
      const core = Math.max(0, 1 - d / 0.5);
      const skirt = Math.max(0, 1 - d);
      const alpha = Math.min(
        1,
        core * core * 0.85 + skirt * skirt * skirt * 0.55,
      );
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  const texture = new T.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
