import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Car by Quaternius, CC0, https://poly.pizza/m/unqqkULtRU . Unbranded distant props.
export async function distantTraffic({ scene, manager, roadY, roadHeight, V }) {
  const src = (
    await new GLTFLoader(manager).loadAsync(
      '/archive/scenery/dolores/assets/quaternius-car.glb',
    )
  ).scene;
  const materials = [];
  src.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry.clone();
      g.deleteAttribute('normal');
      o.geometry = mergeVertices(g, 1e-4);
      o.geometry.computeVertexNormals();
    }
  });
  const positions = [26, 33, 40, 50, 61, 74];
  for (let i = 0; i < positions.length; i++) {
    const x = positions[i],
      body = src.clone(true),
      g = new T.Group();
    body.scale.set(1.13, 1.35, 1.36);
    body.position.y = 0.038;
    const paints = [0x434c52, 0xe2dfd5, 0x516163, 0x844941, 0xb3b5aa, 0x3c4147];
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const name = o.material.name;
      if (name === 'LightBlue')
        o.material = new T.MeshPhysicalMaterial({
          name: 'traffic-paint',
          color: paints[i],
          metalness: 0.28,
          roughness: 0.29,
          clearcoat: 0.9,
          clearcoatRoughness: 0.12,
        });
      else if (name === 'Windows')
        o.material = new T.MeshPhysicalMaterial({
          name: 'traffic-glass',
          color: 0x17252c,
          metalness: 0.5,
          roughness: 0.16,
          clearcoat: 1,
        });
      else {
        o.material = o.material.clone();
        if (name === 'Headlights') o.material.color.set(0xc9cbbf);
        if (name === 'Grey') {
          o.material.metalness = 0.8;
          o.material.roughness = 0.28;
        } else o.material.roughness = 0.65;
      }
      materials.push(o.material);
    });
    const front = roadHeight(x + 1.36),
      back = roadHeight(x - 1.36);
    g.position.copy(V(x, roadY(x) - 4.35, (front + back) / 2));
    g.rotation.set(
      Math.atan2(back - front, 2.72),
      Math.PI / 2 + Math.atan2(roadY(x + 1) - roadY(x - 1), 2),
      0,
      'YXZ',
    );
    g.add(body);
    scene.add(g);
  }
  return materials;
}
