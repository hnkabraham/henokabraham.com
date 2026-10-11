// Shared verbatim offline shader patches. The name is the glTF round-trip key.
// Only three is imported; this module can be lazy-imported by the site.
import { Vector3 } from 'three';
const PREFIX = 'dolores/';
export function applyDoloresMaterial(
  material,
  kind = material.name?.replace(PREFIX, ''),
  options = {},
) {
  const toSun = options.toSun || new Vector3(-0.62434, 0.46947, 0.62434);
  const detail = options.detail || material.emissiveMap;
  const patches = {
    terrain: (s) => {
      s.uniforms.detail = { value: detail };
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vW;\nuniform sampler2D detail;',
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
            // NAIP runs cool and flat: warm and saturate it, then add ground
            // detail that fades out with distance.
            float lumN = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = max(mix(vec3(lumN), diffuseColor.rgb, 1.45) * vec3(1.06, 1.02, 0.86), 0.0);
            float dd = length(vW - cameraPosition);
            float fade = 1.0 - smoothstep(15.0, 160.0, dd);
            vec3 det = texture2D(detail, vW.xz / 4.0).rgb;
            diffuseColor.rgb *= mix(1.0, dot(det, vec3(0.333)) * 2.2, 0.55 * fade);
            float park = step(-110.0,vW.x)*step(vW.x,135.0)*step(-130.0,-vW.z)*step(-vW.z,125.0);
            float green = smoothstep(0.008,0.05,diffuseColor.g-diffuseColor.r*.85);
            float patchiness = .5+.25*sin(vW.x*.27+sin(vW.z*.13))+.25*sin(vW.z*.39+vW.x*.12);
            vec3 turf = det * mix(vec3(.50,1.45,.19),vec3(1.6,1.9,.67),smoothstep(.4,.9,patchiness));
            turf*=.92+.08*sin(vW.x*1.25+vW.z*.6);
            diffuseColor.rgb = mix(diffuseColor.rgb,turf,park*green*.88);`,
        );
    },
    asphalt: (s) => {
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 roadWorld;',
        )
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nroadWorld=(modelMatrix*vec4(transformed,1.)).xyz;',
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 roadWorld;',
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float a=dot(diffuseColor.rgb,vec3(.333));
          float roadPatch=sin(roadWorld.x*.68+sin(roadWorld.z*1.7))*sin(roadWorld.z*.49+sin(roadWorld.x*1.1));
          float curbDist=abs(-roadWorld.z-(-159.9724+roadWorld.x*.07615));
          float oil=smoothstep(2.6,4.6,curbDist)*(0.5+0.5*sin(roadWorld.x*.87+sin(roadWorld.z*3.7)));
          diffuseColor.rgb=vec3(.085+a*.72)*(1.+roadPatch*.11-oil*.21);`,
        );
    },
    bark: (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
    float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=vec3(.068,.076,.061)+vec3(lum)*1.48;`,
      );
    },
    'hero-leaves': (s) => {
      s.uniforms.leafSun = { value: toSun };
      s.fragmentShader = s.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform vec3 leafSun;',
      );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
      vec3 sunView=normalize((viewMatrix*vec4(leafSun,0.0)).xyz);
      float back=pow(max(dot(-normal,sunView),0.0),1.7);
      reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(1.1,1.2,.35)*back*1.1;`,
      );
    },
    'palm-fronds': (s) => {
      s.uniforms.palmSun = { value: toSun };
      s.fragmentShader = s.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform vec3 palmSun;',
      );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
     float back=max(dot(-normal,normalize((viewMatrix*vec4(palmSun,0.)).xyz)),0.);
     reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(1.3,1.35,.5)*back*.65;`,
      );
    },
    'palm-dead': (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
 float dryLum=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=vec3(.30,.16,.06)*dryLum*2.;`,
      );
    },
  };
  patches.gutter = patches.asphalt;
  if (!patches[kind]) return false;
  material.name = PREFIX + kind;
  // The otherwise-black emissive channel transports the ground-detail map.
  if (kind === 'terrain' && detail) material.emissiveMap = detail;
  material.onBeforeCompile = patches[kind];
  material.customProgramCacheKey = () => PREFIX + kind + '/v1';
  if (kind === 'asphalt' || kind === 'gutter') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -4;
  }
  if (material.alphaTest > 0) material.alphaToCoverage = true;
  material.needsUpdate = true;
  return true;
}
export function restoreDoloresMaterials(root, options = {}) {
  const materials = new Set();
  root.traverse((o) => {
    if (o.isMesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        materials.add(m);
  });
  let patched = 0;
  for (const m of materials)
    if (m.name.startsWith(PREFIX))
      patched += Number(applyDoloresMaterial(m, undefined, options));
  return patched;
}
