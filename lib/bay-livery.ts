import {
  CanvasTexture,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { addShaderPatch } from './airframe-flex';

/**
 * The site's own livery. The paint itself (a navy wave that starts under the
 * wing box, sweeps up the aft fuselage into the fin and curls over to the
 * trailing edge with an orange ribbon along its edge, navy engine cowls and
 * raked wingtips) is drawn analytically in the
 * fragment shader from model-space coordinates, so its edges stay crisp at
 * any distance. Only the lettering and the roundel come from this atlas.
 *
 * Model axes: nose −X (−31.4 m), tail +X (31 m), up +Y, port +Z. The
 * fuselage axis runs at y = −3.55 with a 2.95 m radius; the window row sits
 * near y = −2.6; the fin spans x 20.5–31 above y = 0; the engines hang at
 * y = −5.9, z = ±9.77.
 */

/** Atlas regions in canvas pixels [x0, y0, x1, y1]; the canvas is 2048². */
export const LIVERY_ATLAS = 2048;
export const LIVERY_REGIONS = {
  finPort: [0, 0, 1024, 1024],
  finStarboard: [1024, 0, 2048, 1024],
  titles: [0, 1024, 2048, 1280],
  registration: [0, 1280, 1024, 1536],
  url: [1024, 1280, 2048, 1536],
  nacelle: [0, 1536, 512, 2048],
} as const;

/** The fin panel covers this box of the side elevation, in metres. */
const FIN_BOX = { x0: 21, x1: 31, y0: -0.5, y1: 8 };

export const LIVERY_COLORS = {
  navy: '#162d3d',
  orange: '#d9522d',
  cream: '#f7f4e9',
};

/** lucide's `plane` glyph, as the header's brand symbol uses it (24-unit box). */
const PLANE_GLYPH =
  'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z';

const SANS =
  '"Geist", "Geist Sans", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"Geist Mono", "SF Mono", Menlo, Consolas, monospace';

/** Draws `text` centred in a pixel box, fitted to its width with tracking. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  box: readonly number[],
  options: {
    font: string;
    weight: number;
    tracking: number;
    color: string;
    inset?: number;
    capHeight?: number;
  },
) {
  const [x0, y0, x1, y1] = box;
  const inset = options.inset ?? 40;
  const width = x1 - x0 - inset * 2;
  const height = y1 - y0;
  // Measure at a reference size, then scale to fill the box width.
  const reference = 100;
  context.font = `${options.weight} ${reference}px ${options.font}`;
  const glyphs = text.split('');
  const advances = glyphs.map((glyph) => context.measureText(glyph).width);
  const trackingPx = options.tracking * reference;
  const natural =
    advances.reduce((sum, advance) => sum + advance, 0) +
    trackingPx * (glyphs.length - 1);
  // Cap height is about 0.71 em in Geist; keep the letters inside the band.
  const capRatio = options.capHeight ?? 0.71;
  const size = Math.min(
    (reference * width) / natural,
    (height * 0.62) / capRatio,
  );
  context.font = `${options.weight} ${size}px ${options.font}`;
  context.fillStyle = options.color;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  const scale = size / reference;
  const total = natural * scale;
  let x = x0 + (x1 - x0 - total) / 2;
  const y = y0 + height / 2 + capRatio * size * 0.06;
  glyphs.forEach((glyph, index) => {
    context.fillText(glyph, x, y);
    x += advances[index] * scale + trackingPx * scale;
  });
}

function drawAtlas(context: CanvasRenderingContext2D) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, LIVERY_ATLAS, LIVERY_ATLAS);

  // Fin panels: the roundel from the site header, pointing up and toward the
  // nose on both sides. The panel is drawn in metres of side elevation so
  // the disc stays round on the anisotropically mapped fin.
  const fin = (region: readonly number[], mirrored: boolean) => {
    const [x0, y0, x1, y1] = region;
    const sx = (x1 - x0) / (FIN_BOX.x1 - FIN_BOX.x0);
    const sy = (y1 - y0) / (FIN_BOX.y1 - FIN_BOX.y0);
    const px = (mx: number) =>
      mirrored ? x1 - (mx - FIN_BOX.x0) * sx : x0 + (mx - FIN_BOX.x0) * sx;
    const py = (my: number) => y1 - (my - FIN_BOX.y0) * sy;
    const centre = { x: 28.0, y: 2.7 };
    const radius = 1.6;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = LIVERY_COLORS.orange;
    context.beginPath();
    context.ellipse(
      px(centre.x),
      py(centre.y),
      radius * sx,
      radius * sy,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    // The header's plane glyph, 24 units across the disc's radius, climbing
    // at 20° toward the nose on both sides; the port side is flipped and its
    // rotation flips with it. The non-uniform scale keeps it round on the fin.
    const k = radius / 24;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(px(centre.x), py(centre.y));
    context.scale((mirrored ? 1 : -1) * k * sx, k * sy);
    context.rotate((-20 * Math.PI) / 180);
    context.translate(-12, -12);
    context.fillStyle = LIVERY_COLORS.cream;
    context.fill(new Path2D(PLANE_GLYPH));
    context.setTransform(1, 0, 0, 1, 0, 0);
  };
  fin(LIVERY_REGIONS.finPort, false);
  fin(LIVERY_REGIONS.finStarboard, true);

  // Titles forward of the wing, the registration aft, the URL under the
  // belly and the monogram on the engine cowls.
  fitText(context, 'HENOK ABRAHAM', LIVERY_REGIONS.titles, {
    font: SANS,
    weight: 640,
    tracking: 0.08,
    color: LIVERY_COLORS.navy,
    inset: 48,
  });
  fitText(context, 'N787HA', LIVERY_REGIONS.registration, {
    font: SANS,
    weight: 600,
    tracking: 0.04,
    color: LIVERY_COLORS.navy,
    inset: 48,
  });
  fitText(context, 'henokabraham.com', LIVERY_REGIONS.url, {
    font: MONO,
    weight: 500,
    tracking: 0.02,
    color: LIVERY_COLORS.cream,
    inset: 48,
    capHeight: 0.73,
  });
  fitText(context, 'HA', LIVERY_REGIONS.nacelle, {
    font: SANS,
    weight: 700,
    tracking: 0.02,
    color: LIVERY_COLORS.cream,
    inset: 96,
  });
}

/**
 * Draws the lettering atlas at load. The page's fonts are normally ready by
 * the time the aircraft loads; if not, the atlas is redrawn once they are.
 */
export function createLiveryTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = LIVERY_ATLAS;
  canvas.height = LIVERY_ATLAS;
  const context = canvas.getContext('2d');
  if (!context) return null;
  drawAtlas(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  let disposed = false;
  texture.addEventListener('dispose', () => {
    disposed = true;
  });
  if (typeof document !== 'undefined' && document.fonts?.ready)
    void document.fonts.ready.then(() => {
      if (disposed) return;
      drawAtlas(context);
      texture.needsUpdate = true;
    });
  return texture;
}

/** A region as a GLSL vec4 of (u0, v0, u1, v1), v up. */
const uvRect = ([x0, y0, x1, y1]: readonly number[]) =>
  `vec4(${(x0 / LIVERY_ATLAS).toFixed(5)}, ${(1 - y1 / LIVERY_ATLAS).toFixed(5)}, ${(x1 / LIVERY_ATLAS).toFixed(5)}, ${(1 - y0 / LIVERY_ATLAS).toFixed(5)})`;

/** sRGB hex to a linear GLSL vec3 literal. */
const linear = (hex: string) =>
  `vec3(${[1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .map((c) => c.toFixed(4))
    .join(', ')})`;

/**
 * Paints the livery over the base skin in the model's own axes, after the
 * base map and skin detail have been applied. Text reads nose to tail on the
 * port side and tail to nose on the starboard side, as on a real airframe;
 * cabin windows stay dark through the paint.
 */
export function addLivery(material: Material, texture: Texture) {
  addShaderPatch(material, 'livery-v5', (shader) => {
    shader.uniforms.liveryMap = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLiveryPoint;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLiveryPoint = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      uniform sampler2D liveryMap;
      varying vec3 vLiveryPoint;
      const vec3 LIV_NAVY = ${linear(LIVERY_COLORS.navy)};
      const vec3 LIV_ORANGE = ${linear(LIVERY_COLORS.orange)};
      const vec4 LIV_FIN_PORT = ${uvRect(LIVERY_REGIONS.finPort)};
      const vec4 LIV_FIN_STARBOARD = ${uvRect(LIVERY_REGIONS.finStarboard)};
      const vec4 LIV_TITLES = ${uvRect(LIVERY_REGIONS.titles)};
      const vec4 LIV_REGISTRATION = ${uvRect(LIVERY_REGIONS.registration)};
      const vec4 LIV_URL = ${uvRect(LIVERY_REGIONS.url)};
      const vec4 LIV_NACELLE = ${uvRect(LIVERY_REGIONS.nacelle)};
      float liveryBox(vec2 p, vec2 lower, vec2 upper) {
        vec2 inside = step(lower, p) * step(p, upper);
        return inside.x * inside.y;
      }
      vec4 liveryText(vec2 uv, vec4 region) {
        return texture2D(liveryMap, mix(region.xy, region.zw, uv));
      }
      // The wave's edge in the side elevation: a parabola rising from under
      // the wing box to the fin root, then bending over to the trailing edge.
      float liverySweep(float x) {
        float t = max(0.0, (x - 2.5) / 17.5);
        float u = x - 20.0;
        return x < 2.5 ? -6.6 - 2.0 * (2.5 - x)
          : x < 20.0 ? -6.6 + 6.6 * t * t
          : 0.754 * u - 0.019 * u * u;
      }
      float liverySweepSlope(float x) {
        float t = max(0.0, (x - 2.5) / 17.5);
        return x < 2.5 ? -2.0 : x < 20.0 ? 13.2 * t / 17.5 : 0.754 - 0.038 * (x - 20.0);
      }
      float liveryEdge(float d, float aa) { return smoothstep(-aa, aa, d); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      {
        vec3 p = vLiveryPoint;
        float port = step(0.0, p.z);
        vec3 base = diffuseColor.rgb;
        // Cabin windows and other dark base detail show through the paint.
        vec2 section = vec2(p.y + 3.55, p.z);
        float fuselage = (1.0 - smoothstep(3.0, 3.45, length(section))) * step(-31.5, p.x);
        float windows = fuselage * step(abs(section.x - 0.95), 0.55);
        float painted = mix(1.0, smoothstep(0.16, 0.42, dot(base, vec3(0.2126, 0.7152, 0.0722))), windows);
        float fin = step(19.0, p.x) * step(abs(p.z), 1.0) * step(-0.7, p.y);
        float stabiliser = step(26.0, p.x) * step(1.3, abs(p.z));
        float body = max(fuselage, fin) * (1.0 - stabiliser);
        // The wave and its ribbon, measured perpendicular to the edge.
        float h = liverySweep(p.x);
        float slope = liverySweepSlope(p.x);
        float d = (p.y - h) * inversesqrt(1.0 + slope * slope);
        float aa = fwidth(d) + 1e-4;
        float navy = (1.0 - liveryEdge(d, aa)) * body;
        float width = 0.42 + 0.5 * smoothstep(18.0, 23.0, p.x) * (1.0 - smoothstep(25.0, 31.0, p.x));
        float ribbon = liveryEdge(d, aa) * (1.0 - liveryEdge(d - width, aa)) * body
          * smoothstep(-6.2, -5.3, p.y);
        // Raked wingtips, cut at a slant with the same ribbon inboard.
        float tip = abs(p.z) - (26.9 + 0.25 * (p.x - 9.0));
        float tipAa = fwidth(tip) + 1e-4;
        float wing = step(3.0, p.x) * step(-3.0, p.y) * step(p.y, 0.5) * (1.0 - fuselage);
        navy = max(navy, liveryEdge(tip, tipAa) * wing);
        ribbon = max(ribbon, (1.0 - liveryEdge(tip, tipAa)) * liveryEdge(tip + 0.35, tipAa) * wing);
        // Engine cowls: navy behind an orange lip ring, the bare inlet kept.
        float side = sign(p.z);
        vec2 hub = vec2(p.y + 5.9, abs(p.z) - 9.77);
        float rn = length(hub);
        float dz = p.z - side * 9.77;
        float pylon = step(abs(dz), 0.6) * step(-4.5, p.y);
        float cowl = step(-9.9, p.x) * step(p.x, -3.9) * (1.0 - pylon)
          * step(p.x < -8.6 ? 1.55 : 1.05, rn) * (1.0 - smoothstep(2.05, 2.25, rn));
        float lipRing = cowl * step(p.x, -9.5);
        navy = max(navy, cowl * (1.0 - lipRing));
        ribbon = max(ribbon, lipRing);
        vec3 col = mix(base, LIV_NAVY, navy * painted);
        col = mix(col, LIV_ORANGE, ribbon * painted);
        // Lettering and the roundel.
        vec4 art = vec4(0.0);
        float finArt = fin * liveryBox(p.xy, vec2(${FIN_BOX.x0.toFixed(1)}, ${FIN_BOX.y0.toFixed(1)}), vec2(${FIN_BOX.x1.toFixed(1)}, ${FIN_BOX.y1.toFixed(1)}));
        if (finArt > 0.0) art = liveryText(vec2((p.x - ${FIN_BOX.x0.toFixed(1)}) / ${(FIN_BOX.x1 - FIN_BOX.x0).toFixed(1)}, (p.y - ${FIN_BOX.y0.toFixed(1)}) / ${(FIN_BOX.y1 - FIN_BOX.y0).toFixed(1)}), port > 0.5 ? LIV_FIN_PORT : LIV_FIN_STARBOARD);
        float flank = step(1.9, abs(p.z)) * fuselage;
        float titles = flank * liveryBox(p.xy, vec2(-23.5, -2.45), vec2(-9.3, -1.05));
        if (titles > 0.0) art = liveryText(vec2(mix((-9.3 - p.x) / 14.2, (p.x + 23.5) / 14.2, port), (p.y + 2.45) / 1.4), LIV_TITLES);
        float registration = flank * liveryBox(p.xy, vec2(11.0, -2.35), vec2(15.5, -1.35));
        if (registration > 0.0) art = liveryText(vec2(mix((15.5 - p.x) / 4.5, (p.x - 11.0) / 4.5, port), (p.y + 2.35) / 1.0), LIV_REGISTRATION);
        float url = fuselage * step(p.y, -5.6) * liveryBox(vec2(p.x, p.z), vec2(8.5, -0.55), vec2(17.0, 0.55));
        if (url > 0.0) art = liveryText(vec2((p.x - 8.5) / 8.5, 0.5 + p.z / 1.1), LIV_URL);
        float facing = step(0.0, dz);
        float mark = cowl * step(1.1, abs(dz)) * liveryBox(vec2(p.x, hub.x), vec2(-8.55, -0.95), vec2(-6.65, 0.95));
        if (mark > 0.0) art = liveryText(vec2(mix((-6.65 - p.x) / 1.9, (p.x + 8.55) / 1.9, facing), (hub.x + 0.95) / 1.9), LIV_NACELLE);
        col = mix(col, art.rgb, art.a * painted);
        diffuseColor.rgb = col;
      }`,
      );
  });
}
