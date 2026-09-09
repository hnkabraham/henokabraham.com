import {
  ShaderChunk,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';

type ShaderPatch = (shader: WebGLProgramParametersWithUniforms) => void;

/** Composable shader patches; each keeps its own program-cache key segment. */
export function addShaderPatch(
  material: Material,
  key: string,
  patch: ShaderPatch,
) {
  const patches = (material.userData.shaderPatches ??= []) as {
    key: string;
    patch: ShaderPatch;
  }[];
  patches.push({ key, patch });
  material.onBeforeCompile = (shader) =>
    patches.forEach((entry) => entry.patch(shader));
  material.customProgramCacheKey = () =>
    patches.map((entry) => entry.key).join('|');
}

/** Meter-scale elastic wing bend in the model's original nose -X axes. */
export function addWingFlex(material: Material, amount: { value: number }) {
  addShaderPatch(material, 'dreamliner-wing-flex-v1', (shader) => {
    shader.uniforms.wingFlex = amount;
    const definition = `
      uniform float wingFlex;
      float wingEnvelope(vec3 p) { return smoothstep(-12.0,-6.0,p.x)*(1.0-smoothstep(10.0,17.0,p.x)); }
      float wingLift(vec3 p) { float span=max(0.0,abs(p.z)-4.0)/26.0; return wingFlex*span*span*wingEnvelope(p); }
    `;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + definition)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y += wingLift(position);',
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        objectNormal.z -= objectNormal.y * sign(position.z) * 2.0*max(0.0,abs(position.z)-4.0)/676.0 * wingFlex * wingEnvelope(position);`,
      );
  });
}

/**
 * Painted-skin detail the 256 px atlas cannot carry, drawn from model-space
 * coordinates: composite barrel joints, door outlines, a faint belly grime
 * gradient and sparse wing panel lines. Lines antialias with the pixel
 * footprint and fade out once thinner than a pixel, so nothing shimmers at
 * distance. Composes with `addWingFlex` on the same material.
 */
export function addSkinDetail(material: Material) {
  addShaderPatch(material, 'skin-detail-v1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPoint;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSkinPoint = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      varying vec3 vSkinPoint;
      float skinSeams = 0.0;
      float skinLine(float d, float w) {
        float aa = fwidth(d) + 1e-4;
        return (1.0 - smoothstep(w, w + aa, abs(d))) * min(1.0, w / aa);
      }
      float skinOutline(vec2 d, vec2 extent, float w) {
        vec2 q = abs(d) - extent;
        float edge = max(q.x, q.y);
        float aa = fwidth(edge) + 1e-4;
        return (1.0 - smoothstep(w, w + aa, abs(edge))) * min(1.0, w / aa);
      }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
      {
        vec3 p = vSkinPoint;
        vec2 section = vec2(p.y + 0.6, p.z);
        float radius = length(section);
        float fuselage = (1.0 - smoothstep(2.6, 3.3, radius)) * step(-30.5, p.x);
        float arc = atan(section.x, section.y) * 2.9;
        // Five one-piece composite barrels, joined by circumferential splices.
        float joints = skinLine(p.x + 21.0, 0.025) + skinLine(p.x + 10.0, 0.025)
          + skinLine(p.x - 3.0, 0.025) + skinLine(p.x - 14.0, 0.025) + skinLine(p.x - 22.0, 0.025);
        // Passenger doors on both sides, above floor level.
        float side = step(2.2, abs(p.z));
        float doors = side * (
          skinOutline(vec2(p.x + 24.5, p.y - 0.15), vec2(0.53, 0.95), 0.02)
          + skinOutline(vec2(p.x + 8.5, p.y - 0.15), vec2(0.53, 0.95), 0.02)
          + skinOutline(vec2(p.x - 8.5, p.y - 0.15), vec2(0.53, 0.95), 0.02)
          + skinOutline(vec2(p.x - 21.5, p.y - 0.15), vec2(0.53, 0.95), 0.02));
        // Operational grime gathers under the belly and streaks aft.
        float belly = smoothstep(0.3, -2.4, section.x) * (1.0 - smoothstep(-30.0, -24.0, -p.x));
        float streaks = 0.75 + 0.25 * sin(arc * 9.0 + p.x * 0.35) * sin(p.x * 2.3 + arc * 1.7);
        float grime = fuselage * belly * streaks * 0.16;
        // Sparse chordwise wing panel lines outboard of the root fairing.
        float wing = (1.0 - fuselage) * step(3.8, abs(p.z)) * smoothstep(-13.0, -8.0, p.x) * (1.0 - smoothstep(9.0, 15.0, p.x));
        float ribs = skinLine(fract(abs(p.z) / 4.6) * 4.6 - 2.3, 0.02);
        skinSeams = clamp(fuselage * (joints + doors) + wing * ribs * 0.6, 0.0, 1.0);
        diffuseColor.rgb *= (1.0 - 0.14 * skinSeams) * (1.0 - grime);
      }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.62, skinSeams * 0.6);`,
      );
  });
}

/** Cloud cover over the aircraft's position, applied to the sun only. */
export function addCloudShade(material: Material, cloud: { value: number }) {
  addShaderPatch(material, 'cloud-shade-v1', (shader) => {
    shader.uniforms.skinCloud = cloud;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float skinCloud;')
      .replace(
        '#include <lights_fragment_begin>',
        ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= skinCloud;',
        ),
      );
  });
}
