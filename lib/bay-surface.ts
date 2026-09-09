import type { MeshStandardMaterial, Texture } from 'three';
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
/** Web Mercator coordinates are stored relative to this corner for float precision. */
export const MERCATOR_ORIGIN = [SFO_BOUNDS[0], SFO_BOUNDS[1]] as const;

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

export type SurfaceLayer = {
  /** Absolute EPSG:3857 bounds: west, south, east, north. */
  bounds: readonly [number, number, number, number];
  /** May be null while a layer is still downloading. */
  texture: Texture | null;
  /** Feathered border, as a fraction of the layer's extent. */
  feather?: number;
};

export type BaySurfaceControls = {
  /** Seconds, animates the water ripples. */
  time: { value: number };
  /**
   * 0 keeps the photograph's baked light for the simple fallback sky.
   * 1 treats the imagery as albedo lit by the atmosphere's sun and sky.
   */
  lit: { value: number };
  /** Per layer: assign a texture later and raise `ready` from 0 to 1. */
  layers: { texture: { value: Texture | null }; ready: { value: number } }[];
};

type LayerControls = BaySurfaceControls['layers'];
type ShaderParameters = Parameters<
  NonNullable<MeshStandardMaterial['onBeforeCompile']>
>[0];

/** Binds one texture, readiness and Mercator bounds uniform per layer. */
function bindLayerUniforms(
  shader: ShaderParameters,
  layers: SurfaceLayer[],
  controls: LayerControls,
  lit: { value: number },
) {
  shader.uniforms.bayLit = lit;
  layers.forEach((layer, i) => {
    shader.uniforms[`layerMap${i}`] = controls[i].texture;
    shader.uniforms[`layerReady${i}`] = controls[i].ready;
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

/** Fragment declarations shared by every material draped in the imagery. */
function layerDeclarations(layers: SurfaceLayer[]) {
  return `uniform float bayLit;
      ${layers
        .map(
          (_, i) =>
            `uniform sampler2D layerMap${i}; uniform float layerReady${i}; uniform vec4 layerBounds${i};`,
        )
        .join('\n')}
      varying vec2 vMercator;
      vec3 bayImagery(sampler2D map, vec4 bounds, float feather, float ready, vec3 fallback) {
        vec2 uv = (vMercator - bounds.xy) / (bounds.zw - bounds.xy);
        float border = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float weight = smoothstep(0.0, feather, border) * ready;
        if (weight <= 0.0) return fallback;
        vec3 color = texture2D(map, clamp(uv, 0.0, 1.0)).rgb;
        // NAIP's overcast exposure is gently balanced against the wider satellite
        // scene; as albedo under the physical sun it would otherwise read too bright.
        color = max(vec3(0.0), (color - vec3(.16)) * 1.16 + vec3(.16)) * mix(1.0, 0.78, bayLit);
        return mix(fallback, color, weight);
      }`;
}

/** Samples the layers coarse to fine into `target`, starting from its value. */
function layerSampling(layers: SurfaceLayer[], target: string) {
  return layers
    .map(
      (layer, i) =>
        `${target} = bayImagery(layerMap${i}, layerBounds${i}, ${(layer.feather ?? 0.075).toFixed(4)}, layerReady${i}, ${target});`,
    )
    .join('\n');
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
  const layerControls = layers.map((layer) => ({
    texture: { value: layer.texture },
    ready: { value: layer.texture ? 1 : 0 },
  }));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bayTime = time;
    bindLayerUniforms(shader, layers, layerControls, lit);
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
      uniform float bayTime;
      ${detail ? 'uniform sampler2D bayDetailMap; uniform sampler2D bayDetailNormalMap; uniform sampler2D bayWaterNormalMap;' : ''}
      varying vec3 vTerrainPoint;
      float bayDetail = 0.0;
      ${layerDeclarations(layers)}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      ${layerSampling(layers, 'diffuseColor.rgb')}
      float water = (1.0-smoothstep(.25, 1.4, vTerrainPoint.y))
        * smoothstep(1.04, 1.2, diffuseColor.g / max(.001, diffuseColor.r))
        * smoothstep(.75, .95, diffuseColor.b / max(.001, diffuseColor.r));
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
  };
  material.customProgramCacheKey = () =>
    `bay-layers${layers.length}-${detail ? 'grain' : 'flat'}-v4`;
  return { time, lit, layers: layerControls };
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
    bindLayerUniforms(shader, layers, surface.layers, surface.lit);
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
  };
  material.customProgramCacheKey = () => `bay-city-layers${layers.length}-v1`;
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
