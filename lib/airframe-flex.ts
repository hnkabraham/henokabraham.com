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
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSkinPoint;',
      )
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
        float belly = (1.0 - smoothstep(-2.4, 0.3, section.x)) * (1.0 - smoothstep(-30.0, -24.0, -p.x));
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

/**
 * The engines' tail ends, finished by model-space position on the engine
 * interior: the core nozzle and exhaust plug become tempered titanium,
 * bronze toward the lip and the plug's base, that the environment map
 * reflects; the fan duct's walls and casing lose the texture's green cast
 * for a light composite; the outlet guide vanes go to bare metal; and only
 * the last turbine stage's annulus, forward of the lip and seen from
 * inside, carries a faint ember. `heat` scales that ember per frame so it
 * can breathe. Composes with the other patches.
 */
export function addEngineFinish(material: Material, heat: { value: number }) {
  addShaderPatch(material, 'engine-finish-v1', (shader) => {
    shader.uniforms.engineHeat = heat;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vEnginePoint;\nvarying vec3 vEngineNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvEnginePoint = position;\nvEngineNormal = normal;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      uniform float engineHeat;
      varying vec3 vEnginePoint;
      varying vec3 vEngineNormal;
      float engineCore = 0.0;
      float engineDuct = 0.0;
      float engineVanes = 0.0;
      float engineHot = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
      {
        vec3 p = vEnginePoint;
        float r = length(vec2(p.y + 1.12702, abs(p.z) - 9.41336));
        // The nozzle wall, the last stage's annulus and the plug, aft of the turbine.
        engineCore = (1.0 - smoothstep(0.86, 0.98, r)) * smoothstep(-4.2, -3.4, p.x);
        // The ring of outlet guide vanes behind the fan.
        engineVanes = smoothstep(-6.25, -6.1, p.x) * (1.0 - smoothstep(-5.8, -5.65, p.x))
          * smoothstep(0.78, 0.82, r) * (1.0 - smoothstep(1.42, 1.46, r));
        // The fan casing and the duct walls aft of it, out to the sleeve.
        engineDuct = smoothstep(0.98, 1.06, r) * (1.0 - smoothstep(1.9, 2.0, r))
          * smoothstep(-7.8, -7.5, p.x) * (1.0 - smoothstep(-2.85, -2.7, p.x)) * (1.0 - engineVanes);
        float lip = smoothstep(-3.6, -2.5, p.x) * (1.0 - smoothstep(-2.3, -1.2, p.x));
        vec3 titanium = mix(vec3(0.42, 0.40, 0.37), vec3(0.50, 0.35, 0.22), lip * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, titanium, engineCore);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.71, 0.72), engineDuct * 0.8);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.50, 0.52), engineVanes * 0.8);
        engineHot = engineCore * smoothstep(0.58, 0.64, r)
          * smoothstep(-4.0, -3.5, p.x) * (1.0 - smoothstep(-2.9, -2.35, p.x));
      }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.38, engineCore);
      roughnessFactor = mix(roughnessFactor, 0.55, engineDuct);
      roughnessFactor = mix(roughnessFactor, 0.35, engineVanes);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.88, engineCore);
      metalnessFactor = mix(metalnessFactor, 0.12, engineDuct);
      metalnessFactor = mix(metalnessFactor, 0.8, engineVanes);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      {
        // The nozzle is one thin surface: only its inner face, the one seen
        // looking up the tailpipe, glows; the outer face in the fan duct does not.
        vec3 p = vEnginePoint;
        vec3 toAxis = -normalize(vec3(0.0, p.y + 1.12702, p.z - sign(p.z) * 9.41336));
        float inward = step(0.0, dot(normalize(vEngineNormal) * faceDirection, toAxis));
        totalEmissiveRadiance += vec3(0.85, 0.2, 0.03) * engineHot * inward * engineHeat * 0.7;
      }`,
      );
  });
}

/** Cloud cover over the aircraft's position, applied to the sun only. */
export function addCloudShade(material: Material, cloud: { value: number }) {
  addShaderPatch(material, 'cloud-shade-v1', (shader) => {
    shader.uniforms.skinCloud = cloud;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float skinCloud;',
      )
      .replace(
        '#include <lights_fragment_begin>',
        ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= skinCloud;',
        ),
      );
  });
}

/**
 * The caption's plane. Where a glyph of the caption covers a fragment that
 * lies beyond `depth` metres from the lens, the fragment is blended out so
 * the page's own text shows through the canvas; nearer fragments draw over
 * the letters as usual. The mask is sampled by framebuffer position within
 * `rect` (x, y from the bottom left, width, height, in framebuffer pixels),
 * so nothing outside the caption's box pays for the lookup. Opaque
 * materials write without blending, so the colour is premultiplied here for
 * the compositor; do not add this to a transparent material.
 */
export function addDepthCut(
  material: Material,
  cut: {
    mask: { value: unknown };
    rect: { value: number[] };
    depth: { value: number };
    on: { value: number };
  },
) {
  addShaderPatch(material, 'depth-cut-v1', (shader) => {
    shader.uniforms.cutMask = cut.mask;
    shader.uniforms.cutRect = cut.rect;
    shader.uniforms.cutDepth = cut.depth;
    shader.uniforms.cutOn = cut.on;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D cutMask;
        uniform vec4 cutRect;
        uniform float cutDepth;
        uniform float cutOn;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (cutOn > 0.5) {
          vec2 cutUv = (gl_FragCoord.xy - cutRect.xy) / cutRect.zw;
          if (all(greaterThan(cutUv, vec2(0.0))) && all(lessThan(cutUv, vec2(1.0)))) {
            float cover = texture2D(cutMask, cutUv).a;
            float behind = smoothstep(cutDepth - 0.4, cutDepth + 0.4, vViewPosition.z);
            float keep = 1.0 - cover * behind;
            gl_FragColor.rgb *= keep;
            gl_FragColor.a *= keep;
          }
        }`,
      );
  });
}
