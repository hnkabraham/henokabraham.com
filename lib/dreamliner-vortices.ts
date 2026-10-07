import type {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { wingLift } from './dreamliner-engine';
import {
  AIR_FLOW,
  type TrackSource,
  type createFlightTrack,
} from './dreamliner-track';

/**
 * Wingtip vortices, made visible by the vapour that condenses in their
 * cores. Lift leaves each tip as a vortex turning inboard over the top; the
 * pressure at its core drops far enough for the air's moisture to condense
 * when the wing is working hard, so the threads show as the 787 loads up
 * through its climb-out and turn, and are faint in level flight. Each is a
 * thin tube that starts at the raked tip's trailing point, rolls up inboard
 * to settle at about π/4 of the semi-span within a couple of spans, sinks
 * with the wake, and frays out a couple of hundred metres back. The vapour
 * winds round the core in helical striations that the air carries aft, so
 * the tube reads as turning, and the core itself wanders in a slow corkscrew
 * that opens as it ages.
 *
 * Laid along the flown track like the contrails (lib/dreamliner-track.ts),
 * and drawn as one camera-facing ribbon per tip, never thinner than about a
 * pixel and a half, so the threads stay continuous at any range.
 */
const LENGTH = 300;
/** Track samples per thread; the uniform array holds both. */
const SAMPLES = 48;
const STEP = LENGTH / (SAMPLES - 2);
/** Ribbon stations along each thread, in metres. */
const SPACING = 2;
/** The raked tips' trailing points, in model metres (measured off the GLB). */
const TIP = { x: 13.9, y: 3.92, z: 29.7 };
/** How far inboard the rolled-up vortex settles: (1 − π/4) of the semi-span. */
const ROLL = TIP.z * (1 - Math.PI / 4);

/** The two tips: port, then starboard. */
export const VORTEX_SOURCES: TrackSource[] = [1, -1].map((side) => [
  TIP.x,
  TIP.y,
  side * TIP.z,
  wingLift(TIP.x, TIP.z, 1),
]);

const vertexShader = /* glsl */ `
#define SAMPLES ${SAMPLES}
attribute vec3 rib; // metres aft of the tip, across the thread (±1), side (+1 port)
uniform vec4 path[${SAMPLES * 2}]; // the port wake, then starboard; w is the flex
uniform float air; // the air's position along the track at the tip
uniform float pixels; // the drawing buffer's height
uniform vec3 sun;
varying float vAcross;
varying float vAlpha;
varying float vPhase;
varying float vDetail;
varying float vHaze;
varying vec3 vSun;
varying vec3 vSide;
varying vec3 vToward;
vec4 wake(int i) { return path[i]; }
void main() {
  float s = rib.x;
  float side = rib.z;
  int base = side > 0.0 ? 0 : SAMPLES;
  float x = clamp(s / ${STEP.toFixed(4)}, 0.0, float(SAMPLES) - 1.001);
  int i = int(x);
  float f = x - float(i);
  vec4 here0 = wake(base + i), here1 = wake(base + i + 1);
  vec3 centre = mix(here0.xyz, here1.xyz, f);
  // The vortex is as strong as the wing was loaded when it was shed.
  float load = mix(here0.w, here1.w, f);
  vec3 before = wake(base + max(i, 1)).xyz - wake(base + max(i, 1) - 1).xyz;
  vec3 here = here1.xyz - here0.xyz;
  vec3 after = wake(base + min(i + 2, SAMPLES - 1)).xyz - wake(base + min(i + 1, SAMPLES - 2)).xyz;
  vec3 aft = normalize(mix(before + here, here + after, f));
  vec3 port = normalize(cross(aft, vec3(0.0, 1.0, 0.0)));
  vec3 lift = cross(port, aft);
  float u = s / ${LENGTH.toFixed(1)};
  float parcel = air - s;
  // Rolling up inboard, then sinking with the rest of the wake.
  centre -= side * port * ${ROLL.toFixed(3)} * (1.0 - exp(-s / 45.0));
  centre.y -= 7.0 * pow(min(1.0, s / 650.0), 1.25);
  // The core's slow corkscrew, fixed in the air and opening with age.
  float coil = side * 6.2832 * parcel / 110.0;
  centre += (port * cos(coil) + lift * sin(coil)) * (0.04 + 0.22 * smoothstep(0.0, 1.0, u));
  float radius = mix(0.32, 0.9, pow(u, 0.7));
  vec4 view = modelViewMatrix * vec4(centre, 1.0);
  float depth = -view.z;
  vec3 toward = normalize(-view.xyz);
  vec3 across = cross(normalize(mat3(modelViewMatrix) * aft), toward);
  float sideways = length(across);
  across = sideways > 0.0001 ? across / sideways : vec3(1.0, 0.0, 0.0);
  // Never thinner than about a pixel and a half; a thread narrower than
  // that is drawn at that width and fainter in proportion.
  float pixel = 2.0 * depth / (projectionMatrix[1][1] * pixels);
  float width = max(radius, 0.9 * pixel);
  view.xyz += across * rib.y * width;
  gl_Position = projectionMatrix * view;
  float strength = 0.8 * smoothstep(0.95, 1.6, load);
  float fade = smoothstep(0.0, 3.0, s) * (1.0 - smoothstep(0.1, 0.75, u));
  float near = smoothstep(18.0, 60.0, depth);
  vAlpha = strength * fade * near * (radius / width) * smoothstep(0.02, 0.2, sideways);
  vAcross = rib.y;
  vPhase = side * 6.2832 * parcel / 9.0;
  // Striations only where the thread is wide enough on screen to hold them.
  vDetail = smoothstep(3.0, 10.0, width / pixel);
  vHaze = smoothstep(150.0, 1400.0, depth) * 0.45;
  vSun = normalize(mat3(viewMatrix) * sun);
  vSide = across;
  vToward = toward;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 lit;
uniform vec3 shade;
uniform vec3 haze;
varying float vAcross;
varying float vAlpha;
varying float vPhase;
varying float vDetail;
varying float vHaze;
varying vec3 vSun;
varying vec3 vSide;
varying vec3 vToward;
void main() {
  float v = clamp(vAcross, -1.0, 1.0);
  float edge = exp(-3.2 * v * v) - 0.04;
  if (vAlpha * edge < 0.003) discard;
  // Lit as a tube, with the vapour wound round it in helical bands.
  float around = asin(v);
  float bands = 0.5 + 0.5 * sin(3.0 * around + vPhase);
  float body = edge * mix(1.0, mix(0.5, 1.0, bands), vDetail);
  vec3 normal = normalize(vSide * v + vToward * sqrt(1.0 - v * v));
  float light = smoothstep(-0.45, 0.85, dot(normal, vSun));
  vec3 color = mix(mix(shade, lit, light), haze, vHaze);
  gl_FragColor = vec4(color, clamp(body * vAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export type Vortices = ReturnType<typeof createVortices>;

/**
 * Both threads in one draw. Add `mesh` to the scene itself, and each frame
 * call `update` with the tour's progress, the tips' live scene positions
 * (port then starboard), the wing's live flex, the clock and the drawing
 * buffer's height in pixels. `sun` is the light's world direction.
 */
export function createVortices(T: {
  BufferAttribute: typeof BufferAttribute;
  BufferGeometry: typeof BufferGeometry;
  Color: typeof Color;
  DoubleSide: typeof DoubleSide;
  Mesh: typeof Mesh;
  ShaderMaterial: typeof ShaderMaterial;
  Vector3: typeof Vector3;
}) {
  const stations = Math.round(LENGTH / SPACING) + 1;
  const rib: number[] = [],
    index: number[] = [];
  for (const side of [1, -1]) {
    const first = rib.length / 3;
    for (let k = 0; k < stations; k++)
      rib.push(k * SPACING, -1, side, k * SPACING, 1, side);
    for (let k = 0; k < stations - 1; k++) {
      const a = first + k * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('rib', new T.BufferAttribute(new Float32Array(rib), 3));
  // three reads the vertex count from `position`; the shader ignores it.
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array(rib.length), 3),
  );
  geometry.setIndex(index);
  const path = new Float32Array(SAMPLES * 2 * 4);
  const uniforms = {
    path: { value: path },
    air: { value: 0 },
    pixels: { value: 1000 },
    sun: { value: new T.Vector3(0, 1, 0) },
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
    toneMapped: false,
    // The ribbon turns to face the lens either way round.
    side: T.DoubleSide,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    geometry,
    material,
    uniforms,
    update(
      track: ReturnType<typeof createFlightTrack>,
      progress: number,
      tips: ArrayLike<number>,
      flex: number,
      time: number,
      pixels: number,
    ) {
      const flown = track.lay(
        progress,
        VORTEX_SOURCES,
        tips,
        flex,
        SAMPLES,
        STEP,
        path,
      );
      uniforms.air.value = flown + time * AIR_FLOW;
      uniforms.pixels.value = pixels;
    },
  };
}
