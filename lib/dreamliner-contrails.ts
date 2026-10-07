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
import { ENGINE_AXIS, EXHAUST_STATION, wingLift } from './dreamliner-engine';
import {
  AIR_FLOW,
  type TrackSource,
  type createFlightTrack,
} from './dreamliner-track';

/**
 * Condensation trails behind the 787's two engines, laid into the air along
 * the track the aircraft has flown (lib/dreamliner-track.ts), so they stay
 * where they formed while the aircraft banks, climbs and turns away.
 *
 * The exhaust is clear until it has mixed and cooled, so a trail forms some
 * way aft of the nozzle, here 24 m. From there each trail is a stream of
 * soft, camera-facing puffs that belong to the air rather than to the
 * aircraft: each is born at the forming end, drifts aft as the air streams
 * past, and swells, roughens and thins as it ages over 650 m. Its turbulence
 * churns as it goes. The wake does the rest: the tip vortices draw the two
 * trails outboard and down, and far back the pair begins to ripple as the
 * vortices' slow instability takes hold, waves that grow as the air carries
 * them aft. Puffs near the lens fade rather than fill the frame; with the
 * gap, that keeps the opening's look up the tailpipe clear.
 */
export const CONTRAIL_GAP = 24;
const LENGTH = 650;
const RADIUS_NEAR = 0.55;
const RADIUS_FAR = 5;
/** Track samples per trail; the uniform array holds both trails. */
const SAMPLES = 64;
const STEP = (CONTRAIL_GAP + LENGTH) / (SAMPLES - 2);
/**
 * The puffs come in three sizes, each set spaced for its own stretch of the
 * trail and fixed in the air, so the trail's grain moves with the air and
 * not with the aircraft: [start, end, spacing], in metres aft of the nozzle.
 * Neighbouring sets overlap and cross-fade where the trail has grown.
 */
const LAYERS = [
  [CONTRAIL_GAP, 90, 0.3],
  [80, 270, 0.85],
  [250, CONTRAIL_GAP + LENGTH, 2.3],
] as const;

/** The two nozzles: port, then starboard. */
export const CONTRAIL_SOURCES: TrackSource[] = [1, -1].map((side) => [
  EXHAUST_STATION,
  ENGINE_AXIS.y,
  side * ENGINE_AXIS.z,
  wingLift(EXHAUST_STATION, ENGINE_AXIS.z, 1),
]);

const vertexShader = /* glsl */ `
#define SAMPLES ${SAMPLES}
attribute vec3 puff; // index in its set, the set, side (+1 port)
uniform vec4 path[${SAMPLES * 2}]; // the port wake, then starboard
uniform vec4 layers[3]; // start, spacing, fraction, the newest puff's number
uniform float air; // the air's position along the track at the nozzle
uniform float time;
uniform vec3 sun;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vSpin;
varying float vAge;
varying float vHaze;
varying vec3 vSun;
varying vec2 vAxis;
uint mixBits(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  return x ^ (x >> 16);
}
float random(uint key, uint salt) {
  return float(mixBits(key * 7u + salt) & 0xffffffu) / 16777215.0;
}
vec3 wake(int i) { return path[i].xyz; }
void main() {
  int set = int(puff.y);
  vec4 layer = layers[set];
  float side = puff.z;
  float s = layer.x + (layer.z + puff.x) * layer.y;
  // Every puff is a parcel of the air: its number is fixed while it streams
  // aft, so its size, offset and turbulence go with it.
  uint number = uint(int(layer.w) - int(puff.x)) & 0xffffffu;
  uint key = number * 8u + uint(set) * 2u + (side > 0.0 ? 1u : 0u);
  // Where on the laid track this parcel is, and which way the track runs.
  int base = side > 0.0 ? 0 : SAMPLES;
  float x = clamp(s / ${STEP.toFixed(4)}, 0.0, float(SAMPLES) - 1.001);
  int i = int(x);
  float f = x - float(i);
  vec3 centre = mix(wake(base + i), wake(base + i + 1), f);
  vec3 before = wake(base + max(i, 1)) - wake(base + max(i, 1) - 1);
  vec3 here = wake(base + i + 1) - wake(base + i);
  vec3 after = wake(base + min(i + 2, SAMPLES - 1)) - wake(base + min(i + 1, SAMPLES - 2));
  vec3 aft = normalize(mix(before + here, here + after, f));
  vec3 port = normalize(cross(aft, vec3(0.0, 1.0, 0.0)));
  vec3 lift = cross(port, aft);
  float u = clamp((s - ${CONTRAIL_GAP.toFixed(1)}) / ${LENGTH.toFixed(1)}, 0.0, 1.0);
  float parcel = air - s;
  // The trail billows: the turbulence leaves it fatter in some places than
  // others, and the swellings travel aft with the air.
  float swell = 1.0 + smoothstep(0.03, 0.3, u)
    * (0.13 * sin(6.2832 * parcel / 61.0 + 0.7) + 0.06 * sin(6.2832 * parcel / 23.0));
  float radius = mix(${RADIUS_NEAR.toFixed(2)}, ${RADIUS_FAR.toFixed(2)}, pow(u, 0.8)) * swell;
  // The tip vortices draw the trails outboard and down as the wake sinks.
  centre += side * port * 4.0 * u * u;
  centre.y -= 7.0 * pow(u, 1.25);
  // Far back, the vortex pair's slow instability: a ripple, mirrored on the
  // two trails, that grows with age and travels with the air.
  float ripple = 2.2 * smoothstep(0.3, 1.0, u) * sin(6.2832 * parcel / 260.0);
  centre += ripple * 0.7071 * (lift - side * port);
  vec2 jitter = vec2(random(key, 1u), random(key, 2u)) * 2.0 - 1.0;
  centre += (port * jitter.x + lift * jitter.y) * radius * 0.3;
  vec4 view = modelViewMatrix * vec4(centre, 1.0);
  float depth = -view.z;
  float size = radius * (0.85 + 0.35 * random(key, 3u));
  // Stretched along the trail as it crosses the screen, so a line of puffs
  // reads as one body rather than a string of beads; seen end-on, from
  // behind, there is nothing to stretch along and they stay round.
  vec3 along = normalize(mat3(modelViewMatrix) * aft);
  vec2 onScreen = along.xy * depth + view.xy * along.z;
  float reach = length(onScreen) / max(depth, 0.01);
  vec2 axis = reach > 0.0001 ? normalize(onScreen) : vec2(1.0, 0.0);
  float stretch = 1.0 + 1.8 * clamp(reach, 0.0, 1.0);
  view.xy += (axis * position.x * stretch + vec2(-axis.y, axis.x) * position.y) * size;
  gl_Position = projectionMatrix * view;
  // Forming over its first tens of metres, thinning as it spreads, with
  // lumps of denser vapour that the air carries aft.
  float density = smoothstep(0.0, 0.028, u) * (1.0 - smoothstep(0.35, 1.0, u));
  float lumps = parcel / 47.0;
  density *= 0.93 * (0.82 + 0.12 * sin(6.2832 * lumps) + 0.06 * sin(17.3 * lumps + 1.3));
  // A set hands over to the next where the two overlap. Each puff takes its
  // share of the set's opacity by how many neighbours it overlaps; the
  // shares multiply back to the trail's density, overlaps included.
  float weight = set == 0
    ? 1.0 - smoothstep(80.0, 90.0, s)
    : set == 1
      ? smoothstep(80.0, 90.0, s) * (1.0 - smoothstep(250.0, 270.0, s))
      : smoothstep(250.0, 270.0, s);
  float overlap = max(1.0, 2.0 * size / layer.y);
  float share = 1.0 - pow(1.0 - density, weight / overlap);
  float near = smoothstep(25.0, 90.0, depth);
  float projected = size * projectionMatrix[1][1] / max(depth, 0.01);
  float oversize = 1.0 - smoothstep(0.35, 0.8, projected);
  vAlpha = share * near * oversize;
  vUv = position.xy;
  vSeed = random(key, 4u);
  // Each parcel's turbulence turns over slowly, one way or the other.
  float rate = (0.2 + 0.4 * random(key, 5u)) * (random(key, 6u) > 0.5 ? 1.0 : -1.0);
  vSpin = vSeed * 6.2832 + time * rate;
  vAge = u;
  vHaze = smoothstep(150.0, 1400.0, depth) * 0.45;
  vSun = normalize(mat3(viewMatrix) * sun);
  vAxis = axis;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D noise;
uniform vec3 lit;
uniform vec3 shade;
uniform vec3 haze;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vSpin;
varying float vAge;
varying float vHaze;
varying vec3 vSun;
varying vec2 vAxis;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 >= 1.0 || vAlpha < 0.002) discard;
  vec2 turn = vec2(cos(vSpin), sin(vSpin));
  vec2 q = vec2(turn.x * vUv.x - turn.y * vUv.y, turn.y * vUv.x + turn.x * vUv.y);
  float n =
    texture2D(noise, q * 0.45 + vSeed * 7.31).r * 0.65 +
    texture2D(noise, q * 1.1 - vSeed * 3.17).r * 0.35;
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

/** A fixed scatter, so the noise looks the same on every visit. */
const scatter = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Tileable value noise, a few octaves, for the puffs' broken edges. */
export function noiseTexture(T: {
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
 * Both trails in one instanced draw. Add `mesh` to the scene itself, not the
 * aircraft, and each frame call `update` with the tour's progress, the
 * nozzles' live scene positions (port then starboard, x, y, z each), the
 * wing's live flex and the clock. `sun` is the light's world direction.
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
  const puffs: number[] = [];
  for (const side of [1, -1])
    LAYERS.forEach(([start, end, spacing], set) => {
      const count = Math.ceil((end - start) / spacing) + 1;
      for (let i = 0; i < count; i++) puffs.push(i, set, side);
    });
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
    'puff',
    new T.InstancedBufferAttribute(new Float32Array(puffs), 3),
  );
  geometry.instanceCount = puffs.length / 3;
  const noise = noiseTexture(T);
  const path = new Float32Array(SAMPLES * 2 * 4);
  const layers = new Float32Array(12);
  const uniforms = {
    path: { value: path },
    layers: { value: layers },
    air: { value: 0 },
    time: { value: 0 },
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
  return {
    mesh,
    geometry,
    material,
    noise,
    uniforms,
    count: geometry.instanceCount,
    update(
      track: ReturnType<typeof createFlightTrack>,
      progress: number,
      nozzles: ArrayLike<number>,
      flex: number,
      time: number,
    ) {
      const flown = track.lay(
        progress,
        CONTRAIL_SOURCES,
        nozzles,
        flex,
        SAMPLES,
        STEP,
        path,
      );
      const air = flown + time * AIR_FLOW;
      LAYERS.forEach(([start, , spacing], set) => {
        const x = (air - start) / spacing;
        const newest = Math.floor(x);
        layers[set * 4] = start;
        layers[set * 4 + 1] = spacing;
        layers[set * 4 + 2] = x - newest;
        layers[set * 4 + 3] = newest % 0x1000000;
      });
      uniforms.air.value = air;
      uniforms.time.value = time;
    },
  };
}
