import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three';

/** Body colour and stripes; Kona Blue with white stripes by default. */
export const CHASE_CAR_PAINT = { body: 0x1b3a66, stripes: 0xf2efe8 } as const;

/**
 * A stylised Shelby GT350 built from a handful of boxes, in the same axes
 * as the aircraft model (nose -Z, up +Y, right +X), wheels on the ground at
 * y = 0. About 4.8 m long, 1.9 m wide, 1.35 m tall.
 */
export function createChaseCar() {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const own = <G extends BufferGeometry>(geometry: G) => {
    geometries.push(geometry);
    return geometry;
  };
  const paint = new MeshPhysicalMaterial({
    color: CHASE_CAR_PAINT.body,
    roughness: 0.32,
    metalness: 0.1,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
  });
  const stripe = new MeshStandardMaterial({
    color: CHASE_CAR_PAINT.stripes,
    roughness: 0.4,
  });
  const glass = new MeshStandardMaterial({
    color: 0x1a222b,
    roughness: 0.15,
    metalness: 0.5,
  });
  const rubber = new MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 });
  const alloy = new MeshStandardMaterial({
    color: 0x9aa0a6,
    roughness: 0.3,
    metalness: 0.8,
  });
  const lamp = new MeshStandardMaterial({
    color: 0x7a0f14,
    emissive: 0xff2a1e,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });
  materials.push(paint, stripe, glass, rubber, alloy, lamp);
  const group = new Group();
  const add = (
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
    rotationZ = 0,
  ) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotationZ;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Body: lower tub, long hood, fastback cabin, rear deck and a small lip.
  add(own(new BoxGeometry(1.92, 0.58, 4.82)), paint, 0, 0.57, 0);
  add(own(new BoxGeometry(1.86, 0.2, 1.9)), paint, 0, 0.96, -1.25);
  add(own(new BoxGeometry(1.7, 0.42, 2.05)), glass, 0, 1.07, 0.25);
  add(own(new BoxGeometry(1.5, 0.06, 1.35)), paint, 0, 1.31, 0.15);
  add(own(new BoxGeometry(1.86, 0.16, 1.05)), paint, 0, 0.94, 1.85);
  add(own(new BoxGeometry(1.7, 0.05, 0.22)), paint, 0, 1.04, 2.28);
  // Twin racing stripes over the hood, roof and deck.
  for (const x of [-0.19, 0.19]) {
    add(own(new BoxGeometry(0.2, 0.012, 1.9)), stripe, x, 1.065, -1.25);
    add(own(new BoxGeometry(0.2, 0.012, 1.35)), stripe, x, 1.345, 0.15);
    add(own(new BoxGeometry(0.2, 0.012, 1.05)), stripe, x, 1.025, 1.85);
  }
  // Tail lamps, lit: it is braking hard to stay with the aircraft.
  for (const x of [-0.6, 0.6])
    add(own(new BoxGeometry(0.5, 0.1, 0.04)), lamp, x, 0.72, 2.42);
  // Wheels, rotated so the cylinders roll about X.
  const tyre = own(new CylinderGeometry(0.34, 0.34, 0.28, 18));
  const hub = own(new CylinderGeometry(0.2, 0.2, 0.3, 10));
  const wheels: Mesh[] = [];
  for (const x of [-0.83, 0.83])
    for (const z of [-1.5, 1.45]) {
      const wheel = new Group();
      wheel.position.set(x, 0.34, z);
      group.add(wheel);
      const t = new Mesh(tyre, rubber);
      t.rotation.z = Math.PI / 2;
      t.castShadow = true;
      wheel.add(t);
      const h = new Mesh(hub, alloy);
      h.rotation.z = Math.PI / 2;
      wheel.add(h);
      wheels.push(t);
      wheels.push(h);
    }
  return { group, wheels, materials, geometries };
}
