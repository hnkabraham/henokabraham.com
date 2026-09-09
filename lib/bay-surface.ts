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

/** Real aerial imagery on land, animated dielectric reflections only on water. */
export function addBaySurface(
  material: MeshStandardMaterial,
  airport: Texture | null,
) {
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bayTime = time;
    if (airport) shader.uniforms.airportMap = { value: airport };
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
      ${airport ? 'uniform sampler2D airportMap;' : ''}
      varying vec2 vAirportUv;
      varying vec3 vTerrainPoint;`,
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
      diffuseColor.rgb = mix(diffuseColor.rgb, airportColor, detail);`
          : ''
      }
      float water = (1.0-smoothstep(.25, 1.4, vTerrainPoint.y))
        * smoothstep(1.04, 1.2, diffuseColor.g / max(.001, diffuseColor.r))
        * smoothstep(.75, .95, diffuseColor.b / max(.001, diffuseColor.r));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, .26, water);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      vec2 wave = vTerrainPoint.xz;
      float dx = .045*cos(wave.x*.15+wave.y*.11+bayTime*.7) + .024*cos(wave.x*.39-wave.y*.17-bayTime*.9);
      float dz = .045*cos(wave.x*.12-wave.y*.14+bayTime*.6) + .018*cos(wave.x*.27+wave.y*.28+bayTime);
      vec3 waterNormal = normalize((viewMatrix * vec4(normalize(vec3(-dx,1.0,-dz)), 0.0)).xyz);
      normal = normalize(mix(normal, waterNormal, water));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      // Satellite light and shadows are already baked into the land photograph.
      // Keep that tonal detail; the water receives the physical sky/sun response.
      outgoingLight = mix(diffuseColor.rgb*.92, outgoingLight, water);
      #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () =>
    airport ? 'bay-naip-water-v1' : 'bay-water-v1';
  return time;
}
