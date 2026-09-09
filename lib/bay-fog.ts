import {
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';

/**
 * Karl the Fog: a low bank of stratus pouring through the Golden Gate,
 * built as a stack of horizontal translucent sheets whose density comes
 * from drifting value noise, lit by the same sun and sky as the ground so
 * its tops read as a sunlit cloud deck. The bank is centred on the strait
 * and flows east, below the tower tops. `opacity` fades it in and out.
 */
export function createGateFog(frame: {
  origin: readonly [number, number];
  axis: readonly [number, number];
  perp: readonly [number, number];
}) {
  const time = { value: 0 };
  const opacity = { value: 0 };
  // The bank sits 500 m seaward of the deck; the sheets' own X axis points
  // east through the Gate, so the noise simply drifts along +X.
  const centre = [
    frame.origin[0] - frame.perp[0] * 500,
    frame.origin[1] - frame.perp[1] * 500,
  ];
  const geometry = new PlaneGeometry(4400, 2400);
  geometry.rotateX(-Math.PI / 2);
  const heights = [12, 32, 52, 72, 92, 112, 132];
  const group = new Group();
  const materials: MeshStandardMaterial[] = [];
  heights.forEach((height, index) => {
    const material = new MeshStandardMaterial({
      color: 0xf1f2f3,
      roughness: 1,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const layer = { value: index / (heights.length - 1) };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.fogTime = time;
      shader.uniforms.fogOpacity = opacity;
      shader.uniforms.fogLayer = layer;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFogPoint;\nvarying vec2 vFogUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogPoint = position;\nvFogUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
        uniform float fogTime, fogOpacity, fogLayer;
        varying vec3 vFogPoint;
        varying vec2 vFogUv;
        float fogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fogNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fogHash(i), fogHash(i + vec2(1.0, 0.0)), f.x),
                     mix(fogHash(i + vec2(0.0, 1.0)), fogHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fogField(vec2 p) {
          return 0.5 * fogNoise(p) + 0.25 * fogNoise(p * 2.03 + 7.1) + 0.125 * fogNoise(p * 4.07 + 3.3) + 0.0625 * fogNoise(p * 8.11 + 1.7);
        }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        {
          vec2 p = vFogPoint.xz * 0.0016 - vec2(fogTime * 0.012, 0.0) + fogLayer * 0.37;
          float density = fogField(p) / 0.9375;
          // Thinner and patchier toward the top of the bank.
          float threshold = 0.42 + 0.22 * fogLayer;
          float body = smoothstep(threshold, threshold + 0.2, density);
          vec2 edge = smoothstep(vec2(0.0), vec2(0.18, 0.28), vFogUv) * smoothstep(vec2(0.0), vec2(0.18, 0.28), 1.0 - vFogUv);
          diffuseColor.a = body * edge.x * edge.y * fogOpacity * (0.62 - 0.22 * fogLayer);
          // Shade the dense cores a little, as the sun does on a cloud deck.
          diffuseColor.rgb *= mix(0.82, 1.0, smoothstep(0.5, 0.9, density));
        }`,
        );
    };
    material.customProgramCacheKey = () => 'gate-fog-v1';
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(centre[0], height, centre[1]);
    mesh.rotation.y = Math.atan2(-frame.perp[1], frame.perp[0]);
    mesh.renderOrder = 10 + index;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  group.visible = false;
  return { group, materials, geometry, time, opacity };
}
