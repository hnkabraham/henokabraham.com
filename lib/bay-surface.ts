import type { MeshStandardMaterial, Texture } from 'three';

// NAIP's exact EPSG:3857 bounds. Coordinates are converted from the existing
// registered satellite grid rather than introducing a second scenery origin.
export const SFO_BOUNDS = [
  -13626825.603526574, 4521217.699661355, -13618619.768127132,
  4529423.535060797,
] as const;
export function airportUV(sourceX: number, sourceY: number) {
  const mx =
    12.632550004563015 * sourceX -
    0.072422595551702 * sourceY -
    13691784.723241135;
  const my =
    -0.07970501185485107 * sourceX -
    12.68491441838439 * sourceY +
    4635494.015743029;
  return [
    (mx - SFO_BOUNDS[0]) / (SFO_BOUNDS[2] - SFO_BOUNDS[0]),
    (my - SFO_BOUNDS[1]) / (SFO_BOUNDS[3] - SFO_BOUNDS[1]),
  ] as const;
}

export type BaySurfaceControls = {
  /** Seconds, animates the water ripples. */
  time: { value: number };
  /**
   * 0 keeps the photograph's baked light for the simple fallback sky.
   * 1 treats the imagery as albedo lit by the atmosphere's sun and sky.
   */
  lit: { value: number };
};

/**
 * Real aerial imagery on land, animated dielectric reflections only on water.
 * Near the camera a tiling photographed pavement grain adds the surface
 * structure that metre-scale orthoimagery cannot carry.
 */
export function addBaySurface(
  material: MeshStandardMaterial,
  airport: Texture | null,
  detail: { map: Texture; normalMap: Texture } | null = null,
): BaySurfaceControls {
  const time = { value: 0 };
  const lit = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bayTime = time;
    shader.uniforms.bayLit = lit;
    if (airport) shader.uniforms.airportMap = { value: airport };
    if (detail) {
      shader.uniforms.bayDetailMap = { value: detail.map };
      shader.uniforms.bayDetailNormalMap = { value: detail.normalMap };
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
      attribute vec2 airportUv;
      varying vec2 vAirportUv;
      varying vec3 vTerrainPoint;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vAirportUv = airportUv;
      vTerrainPoint = position;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float bayTime;
      uniform float bayLit;
      ${airport ? 'uniform sampler2D airportMap;' : ''}
      ${detail ? 'uniform sampler2D bayDetailMap; uniform sampler2D bayDetailNormalMap;' : ''}
      varying vec2 vAirportUv;
      varying vec3 vTerrainPoint;
      float bayDetail = 0.0;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      ${
        airport
          ? `
      float border = min(min(vAirportUv.x, 1.0-vAirportUv.x), min(vAirportUv.y, 1.0-vAirportUv.y));
      float detail = smoothstep(0.0, .075, border);
      vec3 airportColor = texture2D(airportMap, clamp(vAirportUv, 0.0, 1.0)).rgb;
      // NAIP's overcast exposure is gently balanced against the wider satellite scene.
      airportColor = max(vec3(0.0), (airportColor-vec3(.16))*1.16+vec3(.16));
      // As albedo under the physical sun the overcast orthophoto reads too bright.
      airportColor *= mix(1.0, 0.78, bayLit);
      diffuseColor.rgb = mix(diffuseColor.rgb, airportColor, detail);`
          : ''
      }
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
      roughnessFactor = mix(roughnessFactor, .26, water);`,
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
      }`
          : ''
      }
      vec2 wave = vTerrainPoint.xz;
      float dx = .045*cos(wave.x*.15+wave.y*.11+bayTime*.7) + .024*cos(wave.x*.39-wave.y*.17-bayTime*.9);
      float dz = .045*cos(wave.x*.12-wave.y*.14+bayTime*.6) + .018*cos(wave.x*.27+wave.y*.28+bayTime);
      vec3 waterNormal = normalize((viewMatrix * vec4(normalize(vec3(-dx,1.0,-dz)), 0.0)).xyz);
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
    `bay-${airport ? 'naip' : 'sat'}-${detail ? 'grain' : 'flat'}-v2`;
  return { time, lit };
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
