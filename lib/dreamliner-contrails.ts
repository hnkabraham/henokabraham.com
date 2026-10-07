import type {
  BufferAttribute,
  Color,
  DataTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ENGINE_AXIS, EXHAUST_STATION } from './dreamliner-engine';

/**
 * Condensation trails behind the 787's two engines, in the model's own
 * metres (nose −X, port +Z, up +Y), so they ride the aircraft's heading,
 * climb and bank the way a trail follows a steady flight path.
 *
 * The exhaust is clear until it has mixed and cooled, so a trail forms some
 * way aft of the nozzle, here 24 m. From there each trail is a line of soft,
 * camera-facing puffs, narrow and dense where it forms, wider and rougher as
 * it ages over 650 m, so it reads as a volume from any angle, including
 * end-on from behind. Puffs near the lens fade out rather than fill the
 * frame; with the gap, that keeps the opening's look up the tailpipe clear.
 */
const GAP = 24;
const LENGTH = 650;
const RADIUS_NEAR = 0.55;
const RADIUS_FAR = 5;
/** Centre spacing as a share of a puff's radius: each overlaps ~4 others. */
const SPACING = 0.55;

const radiusAt = (s: number) =>
  RADIUS_NEAR +
  (RADIUS_FAR - RADIUS_NEAR) * Math.min(1, (s - GAP) / LENGTH) ** 0.8;
/** A fixed scatter, so the trails look the same on every visit. */
const scatter = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const vertexShader = /* glsl */ `
attribute vec4 trail; // metres aft of the nozzle, side (+1 port), seed, size
attribute vec2 jitter; // the puff's offset from the trail's axis, in radii
uniform float time;
uniform float engineY;
uniform vec3 sun;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vAge;
varying float vHaze;
varying vec3 vSun;
varying vec2 vAxis;
void main() {
  float s = trail.x;
  float u = clamp((s - ${GAP.toFixed(1)}) / ${LENGTH.toFixed(1)}, 0.0, 1.0);
  float radius = mix(${RADIUS_NEAR.toFixed(2)}, ${RADIUS_FAR.toFixed(2)}, pow(u, 0.8));
  float aft = s - ${GAP.toFixed(1)};
  // The wake sinks and the two trails drift apart a little as they age.
  vec3 centre = vec3(
    ${EXHAUST_STATION.toFixed(3)} + s,
    engineY - aft * 0.004,
    trail.y * (${ENGINE_AXIS.z.toFixed(3)} + aft * 0.004)
  );
  centre.yz += jitter * radius * 0.3;
  vec4 view = modelViewMatrix * vec4(centre, 1.0);
  float depth = -view.z;
  float size = radius * trail.w;
  // Stretched along the trail as it crosses the screen, so a line of puffs
  // reads as one body rather than a string of beads; seen end-on, from
  // behind, there is nothing to stretch along and they stay round.
  vec3 along = normalize(mat3(modelViewMatrix) * vec3(1.0, 0.0, 0.0));
  vec2 onScreen = along.xy * depth + view.xy * along.z;
  float reach = length(onScreen) / max(depth, 0.01);
  vec2 axis = reach > 0.0001 ? normalize(onScreen) : vec2(1.0, 0.0);
  float stretch = 1.0 + 1.8 * clamp(reach, 0.0, 1.0);
  view.xy += (axis * position.x * stretch + vec2(-axis.y, axis.x) * position.y) * size;
  gl_Position = projectionMatrix * view;
  // Forming over its first tens of metres, thinning as it spreads, with
  // lumps of denser vapour drifting aft along it.
  float density = smoothstep(0.0, 0.028, u) * (1.0 - smoothstep(0.35, 1.0, u));
  float drift = s / 53.0 - time * 0.42 + trail.z;
  density *= 0.93 * (0.94 + 0.04 * sin(6.2832 * drift) + 0.02 * sin(17.3 * drift));
  // Each puff overlaps about four neighbours; its own share of the trail's
  // opacity is the fourth root of what lets through.
  float share = 1.0 - pow(1.0 - density, 0.25);
  float near = smoothstep(25.0, 90.0, depth);
  float projected = size * projectionMatrix[1][1] / max(depth, 0.01);
  float oversize = 1.0 - smoothstep(0.35, 0.8, projected);
  vAlpha = share * near * oversize;
  vUv = position.xy;
  vSeed = trail.z;
  vAge = u;
  vHaze = smoothstep(150.0, 1400.0, depth) * 0.45;
  vSun = normalize(mat3(viewMatrix) * sun);
  vAxis = axis;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D noise;
uniform float time;
uniform vec3 lit;
uniform vec3 shade;
uniform vec3 haze;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vAge;
varying float vHaze;
varying vec3 vSun;
varying vec2 vAxis;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 >= 1.0 || vAlpha < 0.002) discard;
  vec2 drift = vec2(time * 0.03, -time * 0.017);
  float n =
    texture2D(noise, vUv * 0.45 + vSeed * 7.31 + drift).r * 0.65 +
    texture2D(noise, vUv * 1.1 - vSeed * 3.17 - drift * 1.6).r * 0.35;
  // Smooth and dense where it forms; the turbulence breaks the edges up
  // as the trail ages and spreads.
  float rough = mix(0.12, 0.6, vAge);
  float body = 1.0 - smoothstep(0.1, 1.0, r2 + (n - 0.5) * rough);
  float alpha = clamp(body * (1.0 - rough + 2.0 * rough * n) * vAlpha, 0.0, 1.0);
  if (alpha < 0.003) discard;
  // Lit as a sphere: bright toward the sun, blue-grey on the far side.
  vec3 normal = vec3(
    vAxis * vUv.x + vec2(-vAxis.y, vAxis.x) * vUv.y,
    sqrt(1.0 - r2)
  );
  float light = smoothstep(-0.45, 0.85, dot(normal, vSun));
  vec3 color = mix(mix(shade, lit, light), haze, vHaze);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

/** Tileable value noise, a few octaves, for the puffs' broken edges. */
function noiseTexture(T: {
  DataTexture: typeof DataTexture;
  LinearFilter: typeof LinearFilter;
  RepeatWrapping: typeof RepeatWrapping;
}) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const lattice = (cells: number, x: number, y: number, seed: number) => {
    const at = (i: number, j: number) =>
      scatter(
        (((i % cells) + cells) % cells) +
          (((j % cells) + cells) % cells) * 97 +
          seed,
      );
    const fx = x - Math.floor(x),
      fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const i = Math.floor(x),
      j = Math.floor(y);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let value = 0,
        weight = 0;
      for (const [cells, amplitude, seed] of [
        [4, 0.5, 11],
        [8, 0.3, 37],
        [16, 0.2, 71],
      ]) {
        value +=
          lattice(cells, (x / size) * cells, (y / size) * cells, seed) *
          amplitude;
        weight += amplitude;
      }
      const v = Math.round((value / weight) * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  const texture = new T.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export type Contrails = ReturnType<typeof createContrails>;

/**
 * Both trails in one instanced draw. Add `mesh` to the aircraft's model
 * group; each frame set `time` and the nozzle height (`engineY`, which
 * rides the wing's flex). `sun` is the light's world direction.
 */
export function createContrails(T: {
  BufferAttribute: typeof BufferAttribute;
  Color: typeof Color;
  DataTexture: typeof DataTexture;
  InstancedBufferAttribute: typeof InstancedBufferAttribute;
  InstancedBufferGeometry: typeof InstancedBufferGeometry;
  LinearFilter: typeof LinearFilter;
  Mesh: typeof Mesh;
  RepeatWrapping: typeof RepeatWrapping;
  ShaderMaterial: typeof ShaderMaterial;
  Vector3: typeof Vector3;
}) {
  const trail: number[] = [],
    jitter: number[] = [];
  let index = 0;
  for (const side of [1, -1])
    for (let s = GAP; s < GAP + LENGTH; s += SPACING * radiusAt(s)) {
      index++;
      trail.push(s, side, scatter(index), 0.8 + 0.45 * scatter(index + 0.5));
      jitter.push(scatter(index + 0.25) * 2 - 1, scatter(index + 0.75) * 2 - 1);
    }
  const geometry = new T.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(
      new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute(
    'trail',
    new T.InstancedBufferAttribute(new Float32Array(trail), 4),
  );
  geometry.setAttribute(
    'jitter',
    new T.InstancedBufferAttribute(new Float32Array(jitter), 2),
  );
  geometry.instanceCount = index;
  const noise = noiseTexture(T);
  const uniforms = {
    time: { value: 0 },
    engineY: { value: ENGINE_AXIS.y },
    sun: { value: new T.Vector3(0, 1, 0) },
    noise: { value: noise },
    // The photograph's own cloud tops, their blue-grey shadows, and the
    // haze toward its horizon, so the trails sit in the same sky.
    lit: { value: new T.Color('#ffffff') },
    shade: { value: new T.Color('#c3cfdb') },
    haze: { value: new T.Color('#cddcea') },
  };
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // Matched to the sky photograph, not the aircraft's tone curve.
    toneMapped: false,
  });
  const mesh = new T.Mesh(geometry, material);
  // The vertex shader places every puff; the quad's own bounds mean nothing.
  mesh.frustumCulled = false;
  return { mesh, geometry, material, noise, uniforms, count: index };
}
