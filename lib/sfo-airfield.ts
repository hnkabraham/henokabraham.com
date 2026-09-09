import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { sampleElevation, type ElevationGrid } from './bay-city';

/** SFO's airfield layout packed by scripts/prepare-sfo-airfield.py (local metres). */
export type Airfield = {
  runways: { ref: string; ends: [number, number][]; width: number }[];
  taxiways: { ref: string; points: [number, number][] }[];
  stands: { ref: string; stop: [number, number]; heading: [number, number] }[];
  holdings: { ref: string; at: [number, number]; heading: [number, number] }[];
  movers: { ref: string; at: [number, number]; heading: [number, number] }[];
  windsocks: [number, number][];
};

/** The painted threshold sits 54 m behind OpenStreetMap's runway end. */
const THRESHOLD = -54;
const PAVEMENT = 3;
/** Tail colours for the parked fleet, deterministic per stand. */
const TAILS = [0x1d3f8a, 0xb01f2b, 0x0e5aa7, 0x214b8f, 0xd2452a, 0x1a6f5a, 0xe4a11b, 0x2f2f6b];

type Frame = { origin: Vector2; forward: Vector2; left: Vector2; span: number };

function runwayFrame(ends: [number, number][]): Frame {
  const origin = new Vector2(ends[0][0], ends[0][1]);
  const forward = new Vector2(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);
  const span = forward.length();
  forward.divideScalar(span);
  return { origin, forward, left: new Vector2(forward.y, -forward.x), span };
}

const at = (frame: Frame, along: number, across: number, y: number) =>
  new Vector3(
    frame.origin.x + frame.forward.x * along + frame.left.x * across,
    y,
    frame.origin.y + frame.forward.y * along + frame.left.y * across,
  );

/** Yaw so that the model's -Z nose points along `heading` (x, z). */
const yaw = (heading: { x: number; y: number }) => Math.atan2(-heading.x, -heading.y);

const hash = (text: string, index: number) => {
  let h = 2166136261 ^ index;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
};

/** Concatenates indexed geometries with position and normal attributes. */
function merge(parts: BufferGeometry[]) {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  for (const part of parts) {
    const base = positions.length / 3;
    const p = part.attributes.position,
      n = part.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const index = part.index;
    if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) indices.push(base + i);
    part.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A flat quad from four corners, facing the winding's normal. */
function quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  const geometry = new BufferGeometry();
  const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray()]), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([...normal.toArray(), ...normal.toArray(), ...normal.toArray(), ...normal.toArray()]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * A generic twin-jet airliner, 38 m long with its nose at -Z and wheels at
 * y = 0: fuselage, low wings with a little dihedral, tailplane, two
 * underwing engines and stub gear in one geometry, the fin in another so
 * it can carry an airline colour per instance.
 */
function createAirliner() {
  const fuselage = new LatheGeometry(
    [
      [0, -19], [1.1, -17.6], [1.7, -15.8], [1.95, -13.5], [1.95, 8],
      [1.6, 12.5], [1.0, 16.5], [0.35, 19],
    ].map(([r, z]) => new Vector2(r, z)),
    16,
  );
  fuselage.rotateX(Math.PI / 2);
  fuselage.translate(0, 3.2, 0);
  const parts: BufferGeometry[] = [fuselage];
  const P = (x: number, y: number, z: number) => new Vector3(x, y, z);
  for (const side of [-1, 1]) {
    parts.push(
      quad(P(side * 1.9, 2.25, -2.5), P(side * 17, 3.6, 6.5), P(side * 17, 3.6, 8.2), P(side * 1.9, 2.25, 4)),
      quad(P(side * 1.9, 2.2, -2.5), P(side * 1.9, 2.2, 4), P(side * 17, 3.55, 8.2), P(side * 17, 3.55, 6.5)),
      quad(P(side * 0.5, 3.6, 14), P(side * 6.5, 3.9, 17), P(side * 6.5, 3.9, 18.5), P(side * 0.5, 3.6, 17.5)),
    );
    const engine = new CylinderGeometry(1.05, 0.95, 3.6, 14);
    engine.rotateX(Math.PI / 2);
    engine.translate(side * 5.5, 1.95, 0.6);
    parts.push(engine);
    const gear = new BoxGeometry(0.45, 1.3, 0.9);
    gear.translate(side * 2.4, 0.65, 1.5);
    parts.push(gear);
  }
  const nose = new BoxGeometry(0.4, 1.3, 0.7);
  nose.translate(0, 0.65, -13);
  parts.push(nose);
  const body = merge(parts);
  const fin = merge([
    quad(P(0.12, 4.8, 12), P(0.12, 4.8, 18.6), P(0.12, 10.8, 19.6), P(0.12, 10.8, 16.4)),
    quad(P(-0.12, 4.8, 12), P(-0.12, 10.8, 16.4), P(-0.12, 10.8, 19.6), P(-0.12, 4.8, 18.6)),
  ]);
  return { body, fin };
}

/** White on black numerals, the red runway sign and yellow taxiway letters in one atlas. */
function createSignAtlas(letters: string[]) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const cell = (index: number) => [(index % 8) * 128, Math.floor(index / 8) * 128] as const;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let n = 1; n <= 11; n++) {
    const [x, y] = cell(n - 1);
    context.fillStyle = '#111111';
    context.fillRect(x, y, 128, 128);
    context.fillStyle = '#f4f4f0';
    context.font = `700 ${n > 9 ? 84 : 100}px ${family}`;
    context.fillText(String(n), x + 64, y + 66);
  }
  letters.forEach((letter, i) => {
    const [x, y] = cell(16 + i);
    context.fillStyle = '#f2c11d';
    context.fillRect(x, y, 128, 128);
    context.fillStyle = '#111111';
    context.font = `700 ${letter.length > 1 ? 72 : 100}px ${family}`;
    context.fillText(letter, x + 64, y + 66);
  });
  context.fillStyle = '#b8231b';
  context.fillRect(0, 384, 512, 128);
  context.fillStyle = '#ffffff';
  context.font = `700 96px ${family}`;
  context.fillText('28R-10L', 256, 450);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The runway designators, drawn tall and condensed like the painted originals. */
function createNumeralTexture(text: string) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, 512, 384);
  context.fillStyle = '#f1eddf';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.save();
  context.translate(256, 200);
  context.scale(0.72, 1);
  context.font = '700 340px "Helvetica Neue", Helvetica, Arial, sans-serif';
  context.fillText(text, 0, 0);
  context.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Everything on the ground that makes the field read as SFO: the approach
 * light piers over the bay behind both 28 thresholds (with the sequenced
 * flashers running toward the runway), threshold and taxiway edge lights,
 * 28R's centreline lights, painted designators and touchdown-zone bars,
 * distance-remaining and holding-position signs, the windsock, and a
 * parked fleet at the stands with a few aircraft out on the taxiways.
 */
export function createAirfield(data: Airfield, elevation: ElevationGrid) {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];
  const ground = (x: number, z: number) => Math.max(PAVEMENT, sampleElevation(elevation, x, z));
  const transform = new Object3D();
  const own = <G extends BufferGeometry>(geometry: G) => {
    geometries.push(geometry);
    return geometry;
  };
  const light = (color: number | [number, number, number]) => {
    const material = new MeshBasicMaterial({ color: 0xffffff });
    material.color = Array.isArray(color) ? new Color(...color) : new Color(color);
    materials.push(material);
    return material;
  };
  const dot = own(new SphereGeometry(0.22, 6, 5));
  const placeAll = (
    geometry: BufferGeometry,
    material: Material,
    points: Vector3[],
    scale = 1,
  ) => {
    const mesh = new InstancedMesh(geometry, material, points.length);
    points.forEach((point, i) => {
      transform.position.copy(point);
      transform.rotation.set(0, 0, 0);
      transform.scale.setScalar(scale);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    });
    group.add(mesh);
    return mesh;
  };

  // Steady lights, gathered by colour into one instanced draw each.
  const white: Vector3[] = [],
    flush: Vector3[] = [],
    red: Vector3[] = [],
    green: Vector3[] = [],
    blue: Vector3[] = [],
    flashers: Vector3[] = [];
  const pier = new Group();
  const deckMaterial = new MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.9 });
  const pileMaterial = new MeshStandardMaterial({ color: 0x4d4a45, roughness: 0.85 });
  materials.push(deckMaterial, pileMaterial);
  const piles: Vector3[] = [];
  const pile = own(new CylinderGeometry(0.28, 0.32, 6, 6));
  for (const runway of data.runways) {
    if (!/28/.test(runway.ref)) continue;
    const frame = runwayFrame(runway.ends);
    const main = runway.ref.includes('28R');
    // The approach lights run out from the threshold, away from the runway,
    // on a trestle once they leave the overrun pavement.
    const out = (d: number, across: number, y: number) => at(frame, THRESHOLD - d, across, y);
    const deckY = 4.6;
    const pierStart = 175,
      pierEnd = 745;
    const deck = own(new BoxGeometry(2.8, 0.5, pierEnd - pierStart));
    const deckMesh = new Mesh(deck, deckMaterial);
    deckMesh.position.copy(out((pierStart + pierEnd) / 2, 0, deckY - 0.25));
    deckMesh.rotation.y = yaw(frame.forward);
    pier.add(deckMesh);
    for (let d = pierStart + 6; d < pierEnd; d += 12)
      for (const side of [-1, 1]) piles.push(out(d, side * 1.1, deckY - 3.2));
    const lampY = (d: number) => (d < pierStart ? PAVEMENT + 0.8 : deckY + 0.7);
    const spacing = main ? 30.5 : 61;
    for (let d = spacing; d <= 732; d += spacing) {
      const y = lampY(d);
      if (d <= 305 || main) {
        const width = d === 305 ? 15 : d === 152 ? 9 : 5;
        for (let k = 0; k < width; k++) white.push(out(d, (k - (width - 1) / 2) * 1.5, y));
      }
      if (main && d <= 305 && d !== 305)
        for (const side of [-1, 1]) for (let k = 0; k < 3; k++) red.push(out(d, side * (4.5 + k * 1.5), y));
      if (d > 305) flashers.push(out(d, 0, y + 0.3));
    }
    // Green threshold lights across the width, red end lights at the far end.
    for (let k = -10; k <= 10; k++) {
      if (k === 0) continue;
      green.push(at(frame, THRESHOLD, k * 3, PAVEMENT + 0.3));
      red.push(at(frame, frame.span + THRESHOLD, k * 3, PAVEMENT + 0.3));
    }
    if (!main) continue;
    // 28R: flush centreline lights, designators, touchdown-zone bars, signs.
    for (let d = 20; d < frame.span - 60; d += 15.24) flush.push(at(frame, THRESHOLD + d, 0, PAVEMENT + 0.04));
    const paint = new MeshStandardMaterial({ color: 0xf1eddf, roughness: 0.85 });
    materials.push(paint);
    const bar = own(new PlaneGeometry(1.8, 22.5));
    bar.rotateX(-Math.PI / 2);
    const bars: Vector3[] = [];
    for (const end of [0, 1]) {
      const base = end === 0 ? THRESHOLD : frame.span + THRESHOLD;
      const sign = end === 0 ? 1 : -1;
      for (const [distance, count] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]])
        for (const side of [-1, 1])
          for (let k = 0; k < count; k++)
            bars.push(at(frame, base + sign * distance, side * (11.9 + k * 3.4), PAVEMENT + 0.075));
      const numerals = createNumeralTexture(end === 0 ? '28R' : '10L');
      if (numerals) {
        textures.push(numerals);
        const material = new MeshStandardMaterial({ map: numerals, transparent: true, alphaTest: 0.4, roughness: 0.85, side: DoubleSide });
        materials.push(material);
        const plane = own(new PlaneGeometry(24, 18));
        plane.rotateX(-Math.PI / 2);
        const mesh = new Mesh(plane, material);
        mesh.position.copy(at(frame, base + sign * 78, 0, PAVEMENT + 0.08));
        mesh.rotation.y = yaw(frame.forward) + (end === 0 ? 0 : Math.PI);
        group.add(mesh);
      }
    }
    const barMesh = placeAll(bar, paint, bars);
    barMesh.rotation.y = 0;
    bars.forEach((point, i) => {
      transform.position.copy(point);
      transform.rotation.set(0, yaw(frame.forward), 0);
      transform.scale.setScalar(1);
      transform.updateMatrix();
      barMesh.setMatrixAt(i, transform.matrix);
    });
    barMesh.instanceMatrix.needsUpdate = true;
    // Signs: distance remaining in thousands of feet along both edges, and
    // the runway holding-position sign pairs where taxiways enter.
    const letters = [...new Set(data.holdings.map((h) => h.ref).filter(Boolean))].slice(0, 16);
    const atlas = createSignAtlas(letters);
    if (atlas) {
      textures.push(atlas);
      const boards: BufferGeometry[] = [];
      const board = (
        centre: Vector3,
        facing: Vector2,
        width: number,
        height: number,
        cell: [number, number, number, number],
      ) => {
        const right = new Vector3(-facing.y, 0, facing.x).multiplyScalar(width / 2);
        const up = new Vector3(0, height / 2, 0);
        const [u0, v0, u1, v1] = cell;
        for (const face of [1, -1]) {
          const r = right.clone().multiplyScalar(face);
          const geometry = quad(
            centre.clone().sub(r).sub(up),
            centre.clone().add(r).sub(up),
            centre.clone().add(r).add(up),
            centre.clone().sub(r).add(up),
          );
          geometry.setAttribute('uv', new BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
          boards.push(geometry);
        }
      };
      const cellUv = (index: number, span = 1): [number, number, number, number] => [
        ((index % 8) * 128) / 1024,
        1 - (Math.floor(index / 8) * 128 + 128) / 512,
        ((index % 8) * 128 + 128 * span) / 1024,
        1 - (Math.floor(index / 8) * 128) / 512,
      ];
      for (let n = 1; n <= 11; n++)
        for (const side of [-1, 1])
          board(at(frame, frame.span + THRESHOLD - n * 304.8, side * 45, PAVEMENT + 1.0), frame.forward, 1.5, 1.2, cellUv(n - 1));
      for (const holding of data.holdings) {
        const heading = new Vector2(holding.heading[0], holding.heading[1]);
        const facing = heading.clone().negate();
        const left = new Vector2(heading.y, -heading.x);
        const centre = new Vector3(holding.at[0], ground(holding.at[0], holding.at[1]) + 0.85, holding.at[1]);
        for (const side of [1, -1]) {
          const offset = new Vector3(left.x, 0, left.y).multiplyScalar(side * 14);
          board(centre.clone().add(offset), facing, 3.2, 0.9, cellUv(24, 4));
          const letter = letters.indexOf(holding.ref);
          if (side === 1 && letter >= 0)
            board(centre.clone().add(offset).add(new Vector3(-facing.y, 0, facing.x).multiplyScalar(2.1)), facing, 0.9, 0.9, cellUv(16 + letter));
        }
      }
      const signGeometry = own(mergeWithUv(boards));
      const signMaterial = new MeshStandardMaterial({ map: atlas, roughness: 0.6 });
      materials.push(signMaterial);
      group.add(new Mesh(signGeometry, signMaterial));
    }
  }
  placeAll(pile, pileMaterial, piles);
  group.add(pier);
  // Blue edge lights every 24 m along both sides of every taxiway.
  for (const taxiway of data.taxiways) {
    const points = taxiway.points;
    let carry = 12;
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, az] = points[i],
        [bx, bz] = points[i + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.1) continue;
      const dx = (bx - ax) / length,
        dz = (bz - az) / length;
      for (let d = carry; d < length; d += 24) {
        const x = ax + dx * d,
          z = az + dz * d;
        for (const side of [-1, 1])
          blue.push(new Vector3(x + dz * side * 11.5, ground(x, z) + 0.25, z - dx * side * 11.5));
      }
      carry = ((carry - length) % 24 + 24) % 24;
    }
  }
  const whiteLight = light([1.35, 1.3, 1.2]);
  placeAll(dot, whiteLight, white);
  placeAll(dot, whiteLight, flush, 0.45);
  placeAll(dot, light([1.5, 0.15, 0.1]), red);
  placeAll(dot, light([0.2, 1.4, 0.45]), green);
  placeAll(dot, light([0.25, 0.45, 1.5]), blue, 0.55);
  const strobeMaterial = light(0xffffff);
  const strobes = placeAll(own(new SphereGeometry(0.4, 8, 6)), strobeMaterial, flashers);
  const idle = new Color(0.3, 0.3, 0.34),
    lit = new Color(3.2, 3.1, 2.8);
  for (let i = 0; i < flashers.length; i++) strobes.setColorAt(i, idle);

  // Windsocks: an orange sock streaming with the usual westerly.
  const sockMaterial = new MeshStandardMaterial({ color: 0xe8681f, roughness: 0.8, side: DoubleSide });
  const poleMaterial = new MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.6, metalness: 0.4 });
  materials.push(sockMaterial, poleMaterial);
  const pole = own(new CylinderGeometry(0.08, 0.1, 8, 6));
  const sock = own(new CylinderGeometry(0.22, 0.5, 3.6, 8, 1, true));
  sock.rotateZ(Math.PI / 2);
  const socks: Mesh[] = [];
  for (const [x, z] of data.windsocks) {
    const y = ground(x, z);
    const post = new Mesh(pole, poleMaterial);
    post.position.set(x, y + 4, z);
    group.add(post);
    const cone = new Mesh(sock, sockMaterial);
    cone.position.set(x, y + 8, z);
    group.add(cone);
    socks.push(cone);
  }

  // The parked fleet and the aircraft on the taxiways.
  const airliner = createAirliner();
  own(airliner.body);
  own(airliner.fin);
  const bodyMaterial = new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.4, metalness: 0.1 });
  const finMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, side: DoubleSide });
  materials.push(bodyMaterial, finMaterial);
  const placed: { position: Vector3; heading: Vector2; scale: number; tail: number }[] = [];
  data.stands.forEach((stand, index) => {
    const key = stand.ref || `stand-${index}`;
    if (hash(key, 1) > 0.62) return;
    const international = /^[AG]\d/.test(stand.ref);
    const wide = international || (!stand.ref && hash(key, 2) < 0.15);
    const scale = wide ? 1.6 : 0.92 + hash(key, 3) * 0.16;
    const heading = new Vector2(stand.heading[0], stand.heading[1]);
    // The lead-in line ends under the nose gear; the fuselage centre sits behind it.
    const position = new Vector3(
      stand.stop[0] - heading.x * 13 * scale,
      ground(stand.stop[0], stand.stop[1]),
      stand.stop[1] - heading.y * 13 * scale,
    );
    placed.push({ position, heading, scale, tail: Math.floor(hash(key, 4) * TAILS.length) });
  });
  data.movers.forEach((mover, index) => {
    placed.push({
      position: new Vector3(mover.at[0], ground(mover.at[0], mover.at[1]), mover.at[1]),
      heading: new Vector2(mover.heading[0], mover.heading[1]),
      scale: 1,
      tail: (index * 3) % TAILS.length,
    });
  });
  const bodies = new InstancedMesh(airliner.body, bodyMaterial, placed.length);
  const fins = new InstancedMesh(airliner.fin, finMaterial, placed.length);
  const matrix = new Matrix4();
  const colour = new Color();
  placed.forEach((plane, i) => {
    transform.position.copy(plane.position);
    transform.rotation.set(0, yaw(plane.heading), 0);
    transform.scale.setScalar(plane.scale);
    transform.updateMatrix();
    matrix.copy(transform.matrix);
    bodies.setMatrixAt(i, matrix);
    fins.setMatrixAt(i, matrix);
    fins.setColorAt(i, colour.set(TAILS[plane.tail]));
  });
  bodies.castShadow = fins.castShadow = false;
  group.add(bodies, fins);

  return {
    group,
    geometries,
    materials,
    textures,
    counts: { aircraft: placed.length, lights: white.length + flush.length + red.length + green.length + blue.length, flashers: flashers.length, piles: piles.length },
    /** Runs the sequenced flashers toward the threshold twice a second and sways the windsocks. */
    update(now: number) {
      const step = Math.floor((now / 500) * flashers.length) % Math.max(1, flashers.length);
      for (let i = 0; i < flashers.length; i++) strobes.setColorAt(i, i === flashers.length - 1 - (step % flashers.length) ? lit : idle);
      if (strobes.instanceColor) strobes.instanceColor.needsUpdate = true;
      for (const cone of socks) {
        cone.rotation.y = 0.35 + 0.18 * Math.sin(now * 0.0011) + 0.06 * Math.sin(now * 0.0037);
        cone.rotation.z = -0.28 + 0.05 * Math.sin(now * 0.0023);
      }
    },
  };
}

/** `merge` for sign boards, which also carry texture coordinates. */
function mergeWithUv(parts: BufferGeometry[]) {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const part of parts) {
    const base = positions.length / 3;
    const p = part.attributes.position,
      n = part.attributes.normal,
      uv = part.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const index = part.index!;
    for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    part.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
