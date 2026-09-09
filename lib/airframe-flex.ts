import type { Material } from 'three';

/** Meter-scale elastic wing bend in the model's original nose -X axes. */
export function addWingFlex(material: Material, amount: { value: number }) {
  material.onBeforeCompile = (shader) => {
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
  };
  material.customProgramCacheKey = () => 'dreamliner-wing-flex-v1';
}
