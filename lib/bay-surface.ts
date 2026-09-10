import { ShaderChunk, type MeshStandardMaterial, type Texture } from 'three';
import { BAY_ORIGIN } from './bay-flight';

// NAIP's exact EPSG:3857 bounds. Coordinates are converted from the existing
// registered satellite grid rather than introducing a second scenery origin.
export const SFO_BOUNDS = [
  -13626825.603526574, 4521217.699661355, -13618619.768127132,
  4529423.535060797,
] as const;
/** Further public-domain NAIP exports, north up in EPSG:3857 (see ASSETS.md). */
export const RUNWAY_BOUNDS = [
  -13623646.065, 4524879.257, -13621046.065, 4527479.257,
] as const;
export const SOUTH_BOUNDS = [
  -13631947.74, 4525293.17, -13615947.74, 4541293.17,
] as const;
export const NORTH_BOUNDS = [
  -13636902.989, 4542449.687, -13620902.989, 4558449.687,
] as const;
/**
 * Desktop-only 1.46 m layer over the climb-out (6144², lazy): South San
 * Francisco, San Bruno and the bay shore where the aircraft is lowest. It
 * takes the slot once planned for a northern-city layer, whose USGS export
 * timed out on every attempt; the corridor layers still cover the north.
 */
export const CLIMB_BOUNDS = [
  -13632500, 4526800, -13623500, 4535800,
] as const;
/** False only if `scripts/prepare-naip-layers.py climb` has not produced the file. */
export const CLIMB_IMAGERY_READY = true;
/** Web Mercator coordinates are stored relative to this corner for float precision. */
export const MERCATOR_ORIGIN = [SFO_BOUNDS[0], SFO_BOUNDS[1]] as const;

/**
 * The Golden Gate Bridge's deck axis, fitted through the OpenStreetMap
 * roadway nodes at both ends of the straight suspended section (ways
 * 537838948 and 595194543, retrieved 2026-09-09): the deck centre in
 * EPSG:3857, the unit axis pointing north along the deck, and the metres
 * per Mercator unit at that latitude. `lib/bay-bridge.ts` builds the 3D
 * bridge in this frame and the terrain shader hides the photographed deck
 * beneath it. Distances along the deck are metres from the centre.
 */
export const GOLDEN_GATE = {
  centre: [-13634254.19, 4554025.73],
  axis: [-0.09205, 0.99575],
  scale: 1.2685,
  /** Tower and anchorage-pylon positions along the deck, metres. */
  towers: [-655, 625],
  pylons: [-998, 968],
} as const;

/** Inverse of `mercator`: EPSG:3857 metres to local scene metres. */
export function mercatorToLocal(mx: number, my: number) {
  const px =
    0.07915772966115583 * mx - 0.0004519390553973489 * my + 1085905.55448784;
  const py =
    -0.0004973835512757917 * mx - 0.0788309597692652 * my + 358610.37375675904;
  return [(px - BAY_ORIGIN[0]) * 10, (py - BAY_ORIGIN[1]) * 10] as const;
}

export function mercator(sourceX: number, sourceY: number) {
  return [
    12.632550004563015 * sourceX -
      0.072422595551702 * sourceY -
      13691784.723241135,
    -0.07970501185485107 * sourceX -
      12.68491441838439 * sourceY +
      4635494.015743029,
  ] as const;
}
export function airportUV(sourceX: number, sourceY: number) {
  const [mx, my] = mercator(sourceX, sourceY);
  return [
    (mx - SFO_BOUNDS[0]) / (SFO_BOUNDS[2] - SFO_BOUNDS[0]),
    (my - SFO_BOUNDS[1]) / (SFO_BOUNDS[3] - SFO_BOUNDS[1]),
  ] as const;
}

/**
 * A streamed layer: a page table (one texel per page at level 0, with a
 * mip per pyramid level) pointing into an atlas of resident tiles. See
 * lib/bay-tiles.ts, which keeps both up to date along the scroll path.
 */
export type VirtualLayer = {
  pageTable: Texture;
  atlas: Texture;
  pages: number;
  tile: number;
  border: number;
  atlasTiles: number;
  levels: number;
  lodBias: number;
};

export type SurfaceLayer = {
  /** Absolute EPSG:3857 bounds: west, south, east, north. */
  bounds: readonly [number, number, number, number];
  /**
   * Whole-texture imagery; null while it is still downloading, absent for
   * a layer that only carries baked shade or streams its imagery.
   */
  texture?: Texture | null;
  /** Streamed imagery over the bounds, instead of one texture. */
  virtual?: VirtualLayer;
  /** Feathered border, as a fraction of the layer's extent. */
  feather?: number;
  /**
   * Baked shading over the same bounds (red: sun, green: sky visibility).
   * Present but null while it is still downloading; absent for none.
   */
  shade?: Texture | null;
};

export type BaySurfaceControls = {
  /** Seconds, animates the water ripples. */
  time: { value: number };
  /**
   * 0 keeps the photograph's baked light for the simple fallback sky.
   * 1 treats the imagery as albedo lit by the atmosphere's sun and sky.
   */
  lit: { value: number };
  /** Tileable noise for the drifting cloud shadows; null disables them. */
  cloud: { value: Texture | null };
  /** Per layer: assign a texture later and raise `ready` from 0 to 1. */
  layers: {
    texture: { value: Texture | null };
    ready: { value: number };
    shade: { value: Texture | null };
    shadeReady: { value: number };
  }[];
};

type ShaderParameters = Parameters<
  NonNullable<MeshStandardMaterial['onBeforeCompile']>
>[0];

/** Binds one texture, readiness and Mercator bounds uniform per layer. */
function bindLayerUniforms(
  shader: ShaderParameters,
  layers: SurfaceLayer[],
  surface: Pick<BaySurfaceControls, 'layers' | 'lit' | 'time' | 'cloud'>,
) {
  shader.uniforms.bayLit = surface.lit;
  shader.uniforms.bayTime = surface.time;
  shader.uniforms.bayCloudMap = surface.cloud;
  layers.forEach((layer, i) => {
    if (layer.virtual) {
      shader.uniforms[`layerPages${i}`] = { value: layer.virtual.pageTable };
      shader.uniforms[`layerAtlas${i}`] = { value: layer.virtual.atlas };
    } else if (hasMap(layer))
      shader.uniforms[`layerMap${i}`] = surface.layers[i].texture;
    shader.uniforms[`layerReady${i}`] = surface.layers[i].ready;
    shader.uniforms[`layerShade${i}`] = surface.layers[i].shade;
    shader.uniforms[`layerShadeReady${i}`] = surface.layers[i].shadeReady;
    shader.uniforms[`layerBounds${i}`] = {
      value: [
        layer.bounds[0] - MERCATOR_ORIGIN[0],
        layer.bounds[1] - MERCATOR_ORIGIN[1],
        layer.bounds[2] - MERCATOR_ORIGIN[0],
        layer.bounds[3] - MERCATOR_ORIGIN[1],
      ],
    };
  });
}

const hasShade = (layer: SurfaceLayer) => layer.shade !== undefined;
const hasMap = (layer: SurfaceLayer) =>
  layer.texture !== undefined && !layer.virtual;
/** Per-layer program key: virtual, mapped or shade-only, with or without shade. */
const layerKey = (layers: SurfaceLayer[]) =>
  layers
    .map(
      (layer) =>
        (layer.virtual ? 'v' : hasMap(layer) ? 'm' : 'x') +
        (hasShade(layer) ? 's' : 'p'),
    )
    .join('');

/**
 * Streamed imagery: pick the pyramid level from the screen-space footprint
 * of one level-0 texel, read the page table at that mip for the best
 * resident page (finer lookups inherit coarser pages), and sample its tile
 * in the atlas inside the filtering border.
 */
function virtualDeclarations(layer: VirtualLayer, i: number) {
  const { pages, tile, border, atlasTiles, levels, lodBias } = layer;
  const cell = tile + 2 * border;
  return `uniform sampler2D layerPages${i}; uniform sampler2D layerAtlas${i};
      // The best resident page at one level, or alpha 0 when none covers it.
      vec4 bayVirtualPage${i}(vec2 uv, float level) {
        vec4 entry = textureLod(layerPages${i}, uv, level);
        if (entry.a < 0.5) return vec4(0.0);
        float pagesAtLevel = ${pages.toFixed(1)} / exp2(floor(entry.b * 255.0 + 0.5));
        vec2 local = fract(uv * pagesAtLevel);
        vec2 slot = floor(entry.rg * 255.0 + 0.5);
        vec2 atlasUv = (slot * ${cell.toFixed(1)} + ${border.toFixed(1)} + local * ${tile.toFixed(1)}) / ${(atlasTiles * cell).toFixed(1)};
        return vec4(texture2D(layerAtlas${i}, atlasUv).rgb, 1.0);
      }
      vec3 bayVirtual${i}(vec3 fallback) {
        vec2 uv = (baySampleAt - layerBounds${i}.xy) / (layerBounds${i}.zw - layerBounds${i}.xy);
        vec2 texels = uv * ${(pages * tile).toFixed(1)};
        vec2 ddx = dFdx(texels), ddy = dFdy(texels);
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return fallback;
        float rawLod = 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)) + 1e-8) + ${lodBias.toFixed(3)};
        // Past the coarsest level the atlas has no mips to minify with; the
        // whole-texture layers underneath take over.
        float reach = 1.0 - smoothstep(${(levels - 1).toFixed(1)}, ${levels.toFixed(1)}, rawLod);
        if (reach <= 0.0) return fallback;
        float lod = clamp(rawLod, 0.0, ${(levels - 1).toFixed(1)});
        // Blend the two nearest levels so neither detail nor a page's
        // source changes at a hard line.
        vec4 near = bayVirtualPage${i}(uv, floor(lod));
        vec4 far = bayVirtualPage${i}(uv, min(floor(lod) + 1.0, ${(levels - 1).toFixed(1)}));
        float mixLevels = fract(lod);
        vec4 picked = near.a < 0.5 ? far : far.a < 0.5 ? near : mix(near, far, mixLevels);
        if (picked.a < 0.5) return fallback;
        vec3 color = picked.rgb;
        color = max(vec3(0.0), (color - vec3(.16)) * 1.16 + vec3(.16)) * mix(1.0, 0.78, bayLit);
        return mix(fallback, color, layerReady${i} * reach);
      }`;
}

/** Fragment declarations shared by every material draped in the imagery. */
function layerDeclarations(layers: SurfaceLayer[]) {
  return `uniform float bayLit;
      uniform float bayTime;
      uniform sampler2D bayCloudMap;
      ${layers
        .map(
          (layer, i) =>
            (hasMap(layer) ? `uniform sampler2D layerMap${i}; ` : '') +
            `uniform float layerReady${i}; uniform vec4 layerBounds${i};` +
            (hasShade(layer)
              ? ` uniform sampler2D layerShade${i}; uniform float layerShadeReady${i};`
              : ''),
        )
        .join('\n')}
      varying vec2 vMercator;
      // Where the layers are read; normally the fragment's own position.
      vec2 baySampleAt = vec2(0.0);
      float bayDirectShade = 1.0;
      float baySkyShade = 1.0;
      float bayLayerWeight(vec4 bounds, float feather, float ready) {
        vec2 uv = (baySampleAt - bounds.xy) / (bounds.zw - bounds.xy);
        float border = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        return smoothstep(0.0, feather, border) * ready;
      }
      vec2 bayLayerUv(vec4 bounds) {
        return clamp((baySampleAt - bounds.xy) / (bounds.zw - bounds.xy), 0.0, 1.0);
      }
      vec3 bayImagery(sampler2D map, vec4 bounds, float feather, float ready, vec3 fallback) {
        float weight = bayLayerWeight(bounds, feather, ready);
        if (weight <= 0.0) return fallback;
        vec3 color = texture2D(map, bayLayerUv(bounds)).rgb;
        // NAIP's overcast exposure is gently balanced against the wider satellite
        // scene; as albedo under the physical sun it would otherwise read too bright.
        color = max(vec3(0.0), (color - vec3(.16)) * 1.16 + vec3(.16)) * mix(1.0, 0.78, bayLit);
        return mix(fallback, color, weight);
      }
      // Baked sun shadow (x) and sky visibility (y) from the same projection.
      vec2 bayShade(sampler2D map, vec4 bounds, float feather, float ready, vec2 fallback) {
        float weight = bayLayerWeight(bounds, feather, ready);
        if (weight <= 0.0) return fallback;
        return mix(fallback, texture2D(map, bayLayerUv(bounds)).rg, weight);
      }
      // Sparse, soft cloud shadows drifting across the whole scene.
      float bayCloud() {
        float noise = texture2D(bayCloudMap, vMercator * 0.00028 + bayTime * vec2(0.0018, 0.0011)).r;
        return smoothstep(0.56, 0.82, noise);
      }
      ${layers
        .map((layer, i) => (layer.virtual ? virtualDeclarations(layer.virtual, i) : ''))
        .join('\n')}`;
}

/**
 * Samples the layers coarse to fine into `target`, starting from its value,
 * at the fragment's position or at `at` (Mercator, relative to the origin).
 */
function layerSampling(layers: SurfaceLayer[], target: string, at = 'vMercator') {
  return (
    `baySampleAt = ${at};\n` +
    layers
      .map((layer, i) =>
        layer.virtual
          ? `${target} = bayVirtual${i}(${target});`
          : hasMap(layer)
            ? `${target} = bayImagery(layerMap${i}, layerBounds${i}, ${(layer.feather ?? 0.075).toFixed(4)}, layerReady${i}, ${target});`
            : '',
      )
      .join('\n')
  );
}

/** Resolves the baked and cloud shading factors for the current fragment. */
function shadeSampling(layers: SurfaceLayer[]) {
  return `baySampleAt = vMercator;
      vec2 bayShadeFactors = vec2(1.0);
      ${layers
        .map((layer, i) =>
          hasShade(layer)
            ? `bayShadeFactors = bayShade(layerShade${i}, layerBounds${i}, ${(layer.feather ?? 0.075).toFixed(4)}, layerShadeReady${i}, bayShadeFactors);`
            : '',
        )
        .join('\n')}
      float bayCloudCover = bayCloud();
      bayDirectShade = bayShadeFactors.x * (1.0 - 0.45 * bayCloudCover);
      baySkyShade = mix(1.0, bayShadeFactors.y, 0.5) * (1.0 - 0.1 * bayCloudCover);`;
}

/**
 * Band over the strait where the orthophoto's displaced deck is hidden,
 * and the water sample that replaces it: 60 m east of the photographed
 * strip, which lies about 30 m east of the true deck. Mercator units.
 */
function bridgeMaskDeclarations() {
  const { centre, axis, scale } = GOLDEN_GATE;
  const f = (n: number) => n.toFixed(3);
  const unit = (m: number) => f(m * scale);
  return `const vec2 bayBridgeOrigin = vec2(${f(centre[0] - MERCATOR_ORIGIN[0])}, ${f(centre[1] - MERCATOR_ORIGIN[1])});
      const vec2 bayBridgeAxis = vec2(${f(axis[0])}, ${f(axis[1])});
      const vec2 bayBridgePerp = vec2(${f(axis[1])}, ${f(-axis[0])});
      float bayBridgeBand() {
        vec2 rel = vMercator - bayBridgeOrigin;
        float along = dot(rel, bayBridgeAxis);
        float across = dot(rel, bayBridgePerp) - ${unit(30)};
        float span = smoothstep(${unit(-1000)}, ${unit(-960)}, along) * (1.0 - smoothstep(${unit(590)}, ${unit(630)}, along));
        return span * (1.0 - smoothstep(${unit(17)}, ${unit(24)}, abs(across)));
      }
      // The replacement water is taken 75-125 m further east, clear of the
      // photographed deck's blurred edge, wandering along the deck so the
      // copy does not streak.
      vec2 bayBridgeWater() {
        vec2 rel = vMercator - bayBridgeOrigin;
        float along = dot(rel, bayBridgeAxis);
        float across = dot(rel, bayBridgePerp);
        float wander = 0.5 + 0.35 * sin(along * 0.11) + 0.15 * sin(along * 0.037 + 1.3);
        return vMercator + bayBridgePerp * (${unit(75)} + ${unit(50)} * wander - across);
      }`;
}

/**
 * Applies `bayDirectShade` to the sun and `baySkyShade` to image-based
 * light by expanding the two lighting chunks in place.
 */
function applyShadeToLights(shader: ShaderParameters) {
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <lights_fragment_begin>',
      ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= bayDirectShade;',
      ),
    )
    .replace(
      '#include <lights_fragment_maps>',
      ShaderChunk.lights_fragment_maps.replace(
        'iblIrradiance += getIBLIrradiance( geometryNormal );',
        'iblIrradiance += getIBLIrradiance( geometryNormal ) * baySkyShade;',
      ),
    );
}

/**
 * Real aerial imagery on land, stacked coarse to fine in one Web Mercator
 * frame, with animated dielectric reflections only on water. Near the camera
 * a tiling photographed pavement grain adds the surface structure that
 * metre-scale orthoimagery cannot carry.
 */
export function addBaySurface(
  material: MeshStandardMaterial,
  layers: SurfaceLayer[],
  detail: {
    map: Texture;
    normalMap: Texture;
    waterNormalMap: Texture;
  } | null = null,
): BaySurfaceControls {
  const time = { value: 0 };
  const lit = { value: 0 };
  const cloud = { value: null as Texture | null };
  const layerControls = layers.map((layer) => ({
    texture: { value: layer.texture ?? null },
    ready: { value: layer.virtual || layer.texture ? 1 : 0 },
    shade: { value: layer.shade ?? null },
    shadeReady: { value: layer.shade ? 1 : 0 },
  }));
  const controls = { time, lit, cloud, layers: layerControls };
  material.onBeforeCompile = (shader) => {
    bindLayerUniforms(shader, layers, controls);
    if (detail) {
      shader.uniforms.bayDetailMap = { value: detail.map };
      shader.uniforms.bayDetailNormalMap = { value: detail.normalMap };
      shader.uniforms.bayWaterNormalMap = { value: detail.waterNormalMap };
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
      attribute vec2 mercator;
      varying vec2 vMercator;
      varying vec3 vTerrainPoint;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vMercator = mercator;
      vTerrainPoint = position;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      ${detail ? 'uniform sampler2D bayDetailMap; uniform sampler2D bayDetailNormalMap; uniform sampler2D bayWaterNormalMap;' : ''}
      varying vec3 vTerrainPoint;
      float bayDetail = 0.0;
      ${layerDeclarations(layers)}
      ${bridgeMaskDeclarations()}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      vec3 bayBase = diffuseColor.rgb;
      ${layerSampling(layers, 'diffuseColor.rgb')}
      // The orthophoto shows the Golden Gate's deck displaced east of the
      // 3D deck (relief displacement of a 70 m high structure). Over the
      // strait, the photographed strip is replaced by the water beside it.
      float bayBridge = bayBridgeBand();
      if (bayBridge > 0.0) {
        vec3 bayUnder = bayBase;
        ${layerSampling(layers, 'bayUnder', 'bayBridgeWater()')}
        diffuseColor.rgb = mix(diffuseColor.rgb, bayUnder, bayBridge);
      }
      ${shadeSampling(layers)}
      // The fallback sky keeps the photograph's light, so darken it directly.
      diffuseColor.rgb *= mix(1.0, 0.55 + 0.45 * bayDirectShade, 1.0 - bayLit);
      // Water is told from the finest imagery's colour at low elevation:
      // south of the runways the corridor layers stop short of the fill,
      // and only the streamed tiles (or the 23 m base map) draw the shore.
      vec3 bayClass = diffuseColor.rgb;
      float water = (1.0-smoothstep(.25, 1.4, vTerrainPoint.y))
        * smoothstep(1.04, 1.2, bayClass.g / max(.001, bayClass.r))
        * smoothstep(.75, .95, bayClass.b / max(.001, bayClass.r));
      ${
        detail
          ? `
      // Two scales of photographed pavement grain, fading out with distance.
      bayDetail = (1.0 - smoothstep(40.0, 900.0, length(vViewPosition))) * (1.0 - water);
      if (bayDetail > 0.001) {
        vec2 grainUv = vTerrainPoint.xz;
        vec3 grain1 = texture2D(bayDetailMap, grainUv * 0.21).rgb;
        vec3 grain2 = texture2D(bayDetailMap, grainUv * 0.043 + vec2(.37, .61)).rgb;
        float grain = dot(mix(grain1, grain2, 0.5), vec3(0.3333)) * 9.5;
        diffuseColor.rgb *= mix(1.0, clamp(grain, 0.45, 1.7), 0.55 * bayDetail);
      }`
          : ''
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, .22, water);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      ${
        detail
          ? `
      if (bayDetail > 0.001) {
        vec3 grainNormal1 = texture2D(bayDetailNormalMap, vTerrainPoint.xz * 0.21).xyz * 2.0 - 1.0;
        vec3 grainNormal2 = texture2D(bayDetailNormalMap, vTerrainPoint.xz * 0.043 + vec2(.37, .61)).xyz * 2.0 - 1.0;
        vec2 tilt = (grainNormal1.xy * 0.7 + grainNormal2.xy * 0.5) * bayDetail;
        normal = normalize(normal + (viewMatrix * vec4(tilt.x, 0.0, -tilt.y, 0.0)).xyz);
      }
      // Wind ripples at two scales drift across the Bay; mipmaps flatten them
      // from altitude so distant water reads as a glossy sheet.
      vec2 ripple1 = texture2D(bayWaterNormalMap, vTerrainPoint.xz * 0.02 + bayTime * vec2(.012, .007)).xy * 2.0 - 1.0;
      vec2 ripple2 = texture2D(bayWaterNormalMap, vTerrainPoint.xz * 0.0045 - bayTime * vec2(.004, .006) + .37).xy * 2.0 - 1.0;
      // Kilometre-scale wind streaks and tide lines stay visible from altitude.
      vec2 streaks = texture2D(bayWaterNormalMap, vTerrainPoint.xz * vec2(0.0012, 0.0004) + bayTime * vec2(.0006, .0002) + .71).xy * 2.0 - 1.0;
      vec2 waterTilt = ripple1 * 0.16 + ripple2 * 0.22 + streaks * 0.12;`
          : `
      vec2 wave = vTerrainPoint.xz;
      vec2 waterTilt = vec2(
        .045*cos(wave.x*.15+wave.y*.11+bayTime*.7) + .024*cos(wave.x*.39-wave.y*.17-bayTime*.9),
        .045*cos(wave.x*.12-wave.y*.14+bayTime*.6) + .018*cos(wave.x*.27+wave.y*.28+bayTime));`
      }
      vec3 waterNormal = normalize((viewMatrix * vec4(normalize(vec3(-waterTilt.x, 1.0, -waterTilt.y)), 0.0)).xyz);
      normal = normalize(mix(normal, waterNormal, water));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      // Under the simple fallback sky the land photograph keeps its baked light;
      // under the physical atmosphere it is albedo lit by the same sun and sky.
      outgoingLight = mix(diffuseColor.rgb*.92, outgoingLight, max(water, bayLit));
      #include <opaque_fragment>`,
    );
    applyShadeToLights(shader);
  };
  material.customProgramCacheKey = () =>
    `bay-layers${layerKey(layers)}-${detail ? 'grain' : 'flat'}-v11`;
  return controls;
}

/**
 * Extruded city massing draped in the same imagery: roofs take the aerial
 * photograph through the shared Mercator projection so they stay continuous
 * with the ground, walls take a per-building tint with floor banding.
 * Expects flat-shaded geometry with a `lift` attribute (metres above the
 * building's base) and vertex colours whose alpha carries the glazing amount.
 */
export function addCityImagery(
  material: MeshStandardMaterial,
  layers: SurfaceLayer[],
  surface: BaySurfaceControls,
  rise: { value: number },
) {
  // Local metres to Mercator relative to MERCATOR_ORIGIN, derived from the
  // registered affine so the roofs use exactly the terrain's projection.
  const [ox, oy] = mercator(BAY_ORIGIN[0], BAY_ORIGIN[1]);
  const [ex, ey] = mercator(BAY_ORIGIN[0] + 1, BAY_ORIGIN[1]);
  const [sx, sy] = mercator(BAY_ORIGIN[0], BAY_ORIGIN[1] + 1);
  const localToMercator = [
    (ex - ox) / 10, (ey - oy) / 10, 0,
    (sx - ox) / 10, (sy - oy) / 10, 0,
    ox - MERCATOR_ORIGIN[0], oy - MERCATOR_ORIGIN[1], 1,
  ];
  material.onBeforeCompile = (shader) => {
    bindLayerUniforms(shader, layers, surface);
    shader.uniforms.cityRise = rise;
    shader.uniforms.cityMercator = { value: localToMercator };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
      attribute float lift;
      uniform float cityRise;
      uniform mat3 cityMercator;
      varying vec2 vMercator;
      varying float vLift;
      varying float vCityY;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      transformed.y -= lift * (1.0 - cityRise);
      vMercator = (cityMercator * vec3(position.x, position.z, 1.0)).xy;
      vLift = lift;
      vCityY = position.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      varying float vLift;
      varying float vCityY;
      float cityRoof = 0.0;
      ${layerDeclarations(layers)}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      vec3 cityNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
      vec3 cityUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      cityRoof = smoothstep(0.5, 0.8, dot(cityNormal, cityUp));
      vec3 roofColor = diffuseColor.rgb;
      ${layerSampling(layers, 'roofColor')}
      ${shadeSampling(layers)}
      // Walls stand in the street's shade only near the ground.
      bayDirectShade = mix(mix(1.0, bayDirectShade, 1.0 - smoothstep(2.0, 12.0, vLift)), bayDirectShade, cityRoof);
      // Glazing bands per floor, stronger on commercial blocks and towers.
      float glass = vColor.a;
      float floorPhase = fract(vCityY / 3.3);
      float glazing = smoothstep(0.28, 0.36, floorPhase) * (1.0 - smoothstep(0.7, 0.78, floorPhase));
      float mullion = step(0.86, fract((vMercator.x + vMercator.y) * 0.45));
      vec3 wallColor = diffuseColor.rgb * mix(1.0, 0.5 + 0.18 * mullion, glazing * (0.12 + 0.75 * glass));
      // Street level is tucked into shade between neighbours.
      wallColor *= mix(0.68, 1.0, smoothstep(0.0, 7.0, vLift));
      diffuseColor.rgb = mix(wallColor, roofColor, cityRoof);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      roughnessFactor = mix(mix(0.78, 0.32, glazing * glass), 0.86, cityRoof);`,
      );
    applyShadeToLights(shader);
  };
  material.customProgramCacheKey = () =>
    `bay-city-layers${layerKey(layers)}-v5`;
}

/**
 * Ground-standing instanced props (tree canopies) lit under the same baked
 * shadows and cloud cover as the terrain they stand on.
 */
export function addGroundShade(
  material: MeshStandardMaterial,
  layers: SurfaceLayer[],
  surface: BaySurfaceControls,
  grow: { value: number } = { value: 1 },
  /** Extra vertex GLSL after `transformed` is set, with a cache-key name. */
  vertexPatch?: { key: string; glsl: string },
) {
  const [ox, oy] = mercator(BAY_ORIGIN[0], BAY_ORIGIN[1]);
  const [ex, ey] = mercator(BAY_ORIGIN[0] + 1, BAY_ORIGIN[1]);
  const [sx, sy] = mercator(BAY_ORIGIN[0], BAY_ORIGIN[1] + 1);
  const localToMercator = [
    (ex - ox) / 10, (ey - oy) / 10, 0,
    (sx - ox) / 10, (sy - oy) / 10, 0,
    ox - MERCATOR_ORIGIN[0], oy - MERCATOR_ORIGIN[1], 1,
  ];
  material.onBeforeCompile = (shader) => {
    bindLayerUniforms(shader, layers, surface);
    shader.uniforms.cityMercator = { value: localToMercator };
    shader.uniforms.bayGrow = grow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
      uniform mat3 cityMercator;
      uniform float bayGrow;
      varying vec2 vMercator;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      // Props grow from their own centre as they arrive.
      transformed *= bayGrow;
      vec3 bayLocal = position;
      #ifdef USE_INSTANCING
      bayLocal = (instanceMatrix * vec4(position, 1.0)).xyz;
      #endif
      vMercator = (cityMercator * vec3(bayLocal.x, bayLocal.z, 1.0)).xy;
      ${vertexPatch?.glsl ?? ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${layerDeclarations(layers)}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      ${shadeSampling(layers)}`,
      );
    applyShadeToLights(shader);
  };
  material.customProgramCacheKey = () =>
    `bay-ground-shade-layers${layerKey(layers)}-v5${vertexPatch ? `|${vertexPatch.key}` : ''}`;
}

/**
 * Breaks the 3 m asphalt tile's repetition along a 3.7 km runway and paints
 * rubber deposits in both touchdown zones, replacing overlaid decal planes.
 */
export function addPavementWear(
  material: MeshStandardMaterial,
  repeat: readonly [number, number],
  width: number,
) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      float bayRubber = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
      vec2 pavRaw = vMapUv / vec2(${repeat[0].toFixed(4)}, ${repeat[1].toFixed(4)});
      vec4 pav1 = texture2D(map, vMapUv);
      vec4 pav2 = texture2D(map, vMapUv * 0.371 + vec2(0.13, 0.57));
      vec3 pav = mix(pav1.rgb, pav2.rgb, 0.5);
      float across = (pavRaw.x - 0.5) * ${width.toFixed(1)};
      float lateral = exp(-across * across / 98.0);
      float streak = 0.55 + 0.45 * sin(across * 2.1 + sin(across * 7.3) * 1.5);
      float zone28 = smoothstep(0.10, 0.16, pavRaw.y) * (1.0 - smoothstep(0.24, 0.36, pavRaw.y));
      float zone10 = smoothstep(0.76, 0.82, pavRaw.y) * (1.0 - smoothstep(0.88, 0.95, pavRaw.y));
      bayRubber = clamp((zone28 + 0.5 * zone10) * lateral * (0.35 + 0.65 * streak), 0.0, 1.0);
      float mottle = 1.0 + 0.09 * sin(pavRaw.y * 640.0 + sin(pavRaw.x * 13.0) * 2.0) * sin(pavRaw.x * 9.0 + pavRaw.y * 97.0);
      diffuseColor.rgb *= pav * mottle * mix(1.0, 0.42, bayRubber);
      #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.75, bayRubber);`,
      );
  };
  material.customProgramCacheKey = () => 'bay-pavement-wear-v1';
}
