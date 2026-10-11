import * as T from 'three';
const V = (x, y, z) => new T.Vector3(x, z, -y);
export function createParkCar({ root, car, roadHeight, canvasTexture }) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = node.receiveShadow = true;
    const original = node.material;
    if (!original.name?.toLowerCase().includes('paint')) return;
    const finish = new T.MeshPhysicalMaterial();
    T.MeshStandardMaterial.prototype.copy.call(finish, original);
    finish.defines = { STANDARD: '', PHYSICAL: '' };
    finish.roughness = 0.45;
    finish.metalness = 0.1;
    finish.clearcoat = 0.35;
    finish.clearcoatRoughness = 0.25;
    node.material = finish;
  });
  const holder = new T.Group();
  // Facing west, nose up the hill: pitch from the road's own slope.
  const wheel = 1.36;
  const zf = roadHeight(car.x - wheel),
    zr = roadHeight(car.x + wheel);
  const pitch = Math.atan2(zf - zr, wheel * 2);
  holder.position.copy(V(car.x, car.y, (zf + zr) / 2 + 0.0215));
  holder.rotation.order = 'YXZ';
  holder.rotation.set(-pitch, -Math.PI / 2, 0);
  holder.add(root);
  holder.userData.carRoot = root;
  // contact shadow
  const blob = canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.5)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const ao = new T.Mesh(
    new T.PlaneGeometry(2.3, 5.0),
    new T.MeshBasicMaterial({
      map: blob,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
    }),
  );
  ao.rotation.x = -Math.PI / 2;
  ao.position.y = -0.0015;
  holder.add(ao);
  for (const xx of [-0.82, 0.82])
    for (const zz of [-1.36, 1.36]) {
      const contact = new T.Mesh(
        new T.PlaneGeometry(0.52, 0.76),
        new T.MeshBasicMaterial({
          map: blob,
          transparent: true,
          depthWrite: false,
          opacity: 0.7,
        }),
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.set(xx, 0.0025, zz);
      holder.add(contact);
    }

  return holder;
}
