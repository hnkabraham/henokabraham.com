import { Effect, EffectAttribute } from 'postprocessing';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  Mesh,
  NormalBlending,
  type Object3D,
  type PerspectiveCamera,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import { smooth } from './bay-flight';

/**
 * Visible thrust. Two effects, both driven by the flight's progress:
 *
 * - Heat haze behind each engine: a screen-space refraction in the
 *   post-processing chain, shaped by two exhaust cones projected from the
 *   core nozzles and occluded by the scene depth, so the runway, apron and
 *   scenery shimmer through the exhaust at takeoff power.
 * - Wingtip vortices: helical vapour threads off the raked tips while the
 *   wing is loaded through rotation and the initial climb (and during the
 *   stunts), drawn as two crossed noise-lit ribbons per tip in one mesh.
 *
 * Model axes: nose −X, up +Y, port +Z; the engines' cores exit near
 * x = −2.4 at y = −5.9, z = ±9.77, and the raked tips end near (11.8, −0.8,
 * ±29.5).
 */

/** Core nozzle exits in model axes, and how far the visible plume reaches. */
export const NOZZLES: readonly [number, number, number][] = [
  [-2.4, -5.9, 9.77],
  [-2.4, -5.9, -9.77],
];
export const PLUME_LENGTH = 24;
export const WINGTIPS: readonly [number, number, number][] = [
  [11.8, -0.8, 29.5],
  [11.8, -0.8, -29.5],
];
const VORTEX_LENGTH = 46;

/**
 * Thrust as a fraction of takeoff power along the scroll: idle at the hold,
 * spooling up at brake release (progress 0.15), full power through the roll
 * and rotation, then climb power once established.
 */
export function thrustSetting(progress: number) {
  const spool = smooth((progress - 0.11) / 0.07);
  const climb = smooth((progress - 0.6) / 0.15);
  return 0.12 + 0.88 * spool - 0.42 * climb;
}

/** How strongly the tips pull vapour: rotation through the early climb. */
export function vortexSetting(progress: number) {
  return (
    smooth((progress - 0.395) / 0.05) * (1 - smooth((progress - 0.6) / 0.12))
  );
}

const HAZE_FRAGMENT = /* glsl */ `
uniform vec3 plumeA[2];
uniform vec3 plumeB[2];
uniform float heat;
uniform float hazeFocal;
uniform float hazeTime;
uniform mat4 hazeProjectionInverse;

float hazeHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hazeNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hazeHash(i), hazeHash(i + vec2(1.0, 0.0)), f.x),
    mix(hazeHash(i + vec2(0.0, 1.0)), hazeHash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
float hazeTurbulence(vec2 p) {
  return hazeNoise(p) + 0.5 * hazeNoise(p * 2.3 + 1.7) + 0.25 * hazeNoise(p * 5.1 + 3.9);
}

void mainUv(inout vec2 uv) {
  if (heat <= 0.001) return;
  vec4 h = hazeProjectionInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(h.xyz / h.w);
  float sceneZ = getViewZ(readDepth(uv));
  vec2 offset = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 a = plumeA[i];
    vec3 ab = plumeB[i] - a;
    float len = length(ab);
    vec3 axis = ab / len;
    // Closest points between the view ray and the exhaust axis.
    float dd = dot(dir, axis);
    float denom = max(1e-4, 1.0 - dd * dd);
    float da = dot(a, dir);
    float u = clamp((dd * da - dot(a, axis)) / denom, 0.0, len);
    float s = da + u * dd;
    if (s <= 0.5) continue;
    vec3 point = a + axis * u;
    vec3 w = dir * s - point;
    float t = u / len;
    float radius = mix(1.0, 3.4, t);
    float k = 1.0 - length(w) / radius;
    if (k <= 0.0) continue;
    // The haze is densest just aft of the nozzle and thins with the plume;
    // anything in front of the plume point hides it. The plume's end cap sits
    // at t == 1 exactly, and pow(0.0, 1.6) is undefined in GLSL: Metal returns
    // NaN there, which clamps the sampled uv to a corner and stamps a flat
    // disc over the scene. Keep the base off zero.
    float fall = k * k * pow(max(1.0 - t, 1e-4), 1.6) * smoothstep(0.0, 0.05, t);
    float visible = 1.0 - smoothstep(0.4, 1.6, sceneZ - s * dir.z);
    vec3 side = normalize(cross(axis, abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 rise = cross(side, axis);
    vec2 local = vec2(u * 0.55 - hazeTime * 9.0, dot(w, side) * 0.9 + dot(w, rise) * 0.4 + float(i) * 5.1);
    vec2 n = vec2(hazeTurbulence(local), hazeTurbulence(local + vec2(3.7, 8.2))) - 0.875;
    // Up to 0.9 m of apparent displacement at the plume, in screen units.
    offset += n * (0.9 * heat * fall * visible * hazeFocal / s) * vec2(1.0 / aspect, 1.0);
  }
  // Two percent of the frame is far more than a plume should ever displace;
  // bounding the sum keeps one bad term from smearing the whole image.
  uv = clamp(uv + clamp(offset, -0.02, 0.02), 0.0, 1.0);
}
`;

/**
 * The heat-haze effect for the composer. `update` places the plumes in
 * view space each frame from the airframe's transform via `place`.
 */
export class HeatHazeEffect extends Effect {
  private readonly view = new Matrix4();

  constructor() {
    super('HeatHazeEffect', HAZE_FRAGMENT, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['plumeA', new Uniform([new Vector3(), new Vector3()])],
        ['plumeB', new Uniform([new Vector3(), new Vector3()])],
        ['heat', new Uniform(0)],
        ['hazeFocal', new Uniform(1)],
        ['hazeTime', new Uniform(0)],
        ['hazeProjectionInverse', new Uniform(new Matrix4())],
      ]),
    });
  }

  place(
    airframe: Object3D,
    camera: PerspectiveCamera,
    thrust: number,
    time: number,
  ) {
    const uniforms = this.uniforms;
    uniforms.get('heat')!.value = thrust;
    uniforms.get('hazeTime')!.value = time;
    uniforms.get('hazeFocal')!.value =
      1 / (2 * Math.tan((camera.fov * Math.PI) / 360));
    (uniforms.get('hazeProjectionInverse')!.value as Matrix4).copy(
      camera.projectionMatrixInverse,
    );
    airframe.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    this.view.copy(camera.matrixWorld).invert();
    const starts = uniforms.get('plumeA')!.value as Vector3[];
    const ends = uniforms.get('plumeB')!.value as Vector3[];
    NOZZLES.forEach((nozzle, index) => {
      starts[index]
        .set(nozzle[0], nozzle[1], nozzle[2])
        .applyMatrix4(airframe.matrixWorld)
        .applyMatrix4(this.view);
      ends[index]
        .set(nozzle[0] + PLUME_LENGTH, nozzle[1], nozzle[2])
        .applyMatrix4(airframe.matrixWorld)
        .applyMatrix4(this.view);
    });
  }
}

const VORTEX_VERTEX = /* glsl */ `
attribute float along;
attribute float edge;
attribute float side;
attribute float blade;
uniform float vortexTime;
varying float vAlong;
varying float vEdge;
varying float vSide;
void main() {
  vAlong = along;
  vEdge = edge;
  vSide = side;
  // A thread that spirals outward as it trails aft, opposite-handed per tip.
  float theta = along * 11.0 - vortexTime * 7.0 * side;
  float radius = 0.08 + 0.7 * along * along;
  vec3 centre = position + vec3(along * ${VORTEX_LENGTH.toFixed(1)}, radius * cos(theta), radius * sin(theta) * side);
  float width = 0.16 + 0.45 * along;
  vec3 across = blade > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(centre + across * (edge * width), 1.0);
}
`;

const VORTEX_FRAGMENT = /* glsl */ `
uniform float vortexTime;
uniform float vortexStrength;
varying float vAlong;
varying float vEdge;
varying float vSide;
float vortexHash(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float vortexNoise(float p) {
  float i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(vortexHash(i), vortexHash(i + 1.0), f);
}
void main() {
  float flow = vAlong * 9.0 - vortexTime * 5.0 + vSide * 3.0;
  float wisp = 0.55 + 0.45 * vortexNoise(flow) * vortexNoise(flow * 2.7 + 11.0);
  float profile = pow(max(0.0, 1.0 - abs(vEdge)), 1.6);
  // Interpolation can nudge vAlong past 1; a negative pow base is NaN, and
  // one NaN pixel blooms into a black square.
  float reach = smoothstep(0.0, 0.04, vAlong) * pow(max(0.0, 1.0 - vAlong), 1.4);
  float alpha = vortexStrength * wisp * profile * reach * 0.75;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), alpha);
}
`;

/**
 * Vapour threads off both raked tips: two crossed ribbons per tip in one
 * mesh, attached to the airframe and lit by their own alpha noise.
 */
export function createWingtipVortices() {
  const segments = 72;
  const strips = WINGTIPS.length * 2;
  const rows = segments + 1;
  const positions = new Float32Array(strips * rows * 2 * 3);
  const along = new Float32Array(strips * rows * 2);
  const edge = new Float32Array(strips * rows * 2);
  const side = new Float32Array(strips * rows * 2);
  const blade = new Float32Array(strips * rows * 2);
  const index: number[] = [];
  let vertex = 0;
  WINGTIPS.forEach((tip) => {
    for (let b = 0; b < 2; b++) {
      const first = vertex;
      for (let r = 0; r < rows; r++) {
        for (let e = 0; e < 2; e++) {
          positions.set(tip, vertex * 3);
          along[vertex] = r / segments;
          edge[vertex] = e === 0 ? -1 : 1;
          side[vertex] = Math.sign(tip[2]);
          blade[vertex] = b;
          vertex++;
        }
        if (r > 0) {
          const v = first + r * 2;
          index.push(v - 2, v - 1, v, v - 1, v + 1, v);
        }
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('along', new BufferAttribute(along, 1));
  geometry.setAttribute('edge', new BufferAttribute(edge, 1));
  geometry.setAttribute('side', new BufferAttribute(side, 1));
  geometry.setAttribute('blade', new BufferAttribute(blade, 1));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    vertexShader: VORTEX_VERTEX,
    fragmentShader: VORTEX_FRAGMENT,
    uniforms: {
      vortexTime: { value: 0 },
      vortexStrength: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'wingtip-vortices';
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    geometry,
    material,
    update(strength: number, time: number) {
      material.uniforms.vortexStrength.value = strength;
      material.uniforms.vortexTime.value = time;
      mesh.visible = strength > 0.005;
    },
  };
}
