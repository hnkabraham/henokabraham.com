import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural geometry; no image tracing. Local tree coordinates are X/up/Z.
export function heroTree({ scene, load, V, edgeHeight, num, rng, toSun }) {
  rng = (() => {
    let seed = 971 + num('seed', 7);
    return () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  })();
  const barkMap = load(
    '/archive/scenery/dolores/assets/bark_platanus_diff_2k.jpg',
  );
  const barkNormal = load(
    '/archive/scenery/dolores/assets/bark_platanus_nor_gl_2k.jpg',
    false,
  );
  const bark = new T.MeshStandardMaterial({
    map: barkMap,
    normalMap: barkNormal,
    normalScale: new T.Vector2(0.16, 0.16),
    color: 0xffffff,
    roughness: 0.95,
  });
  bark.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
    float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=vec3(.068,.076,.061)+vec3(lum)*1.48;`,
    );
  };
  const tree = new T.Group();
  const tx = num('heroTreeX', 10.6),
    ty = num('heroTreeY', -148.5);
  tree.position.copy(V(tx, ty, edgeHeight(tx)));
  tree.scale.setScalar(num('heroTreeScale', 1));
  const woody = [];
  const tips = [];
  function limb(points, r0, r1, segments = 28) {
    const curve = new T.CatmullRomCurve3(
      points.map((p) => (p.isVector3 ? p : new T.Vector3(...p))),
    );
    const rs = 24;
    const g = new T.TubeGeometry(curve, segments, 1, rs, false),
      p = g.attributes.position,
      uv = g.attributes.uv;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments,
        c = curve.getPointAt(t),
        r = T.MathUtils.lerp(r0, r1, t);
      for (let j = 0; j <= rs; j++) {
        const k = i * (rs + 1) + j,
          v = new T.Vector3().fromBufferAttribute(p, k).sub(c);
        const variation =
          1 +
          0.055 * Math.sin((j / rs) * Math.PI * 6 + t * 7) +
          0.028 * Math.sin(t * 24 + j);
        v.multiplyScalar(r * variation).add(c);
        p.setXYZ(k, v.x, v.y, v.z);
        uv.setXY(
          k,
          (j / rs) * Math.max(0.35, r0 * 2.1),
          (t * curve.getLength()) / 4.5,
        );
      }
    }
    g.computeVertexNormals();
    woody.push(g);
    return curve;
  }
  const main = [
    {
      p: [
        [0, -0.12, 0],
        [-0.1, 1.2, 0.06],
        [0.03, 2.9, 0.02],
        [0.48, 4.6, -0.08],
        [0.72, 6.1, -0.3],
        [-0.1, 8.3, -0.35],
        [-1.4, 11.5, -0.7],
      ],
      r: 0.68,
      end: 0.23,
    },
    {
      p: [
        [0.15, 3.75, 0],
        [0.98, 4.7, -0.12],
        [2.45, 5.05, -0.23],
        [4.1, 5.36, -0.5],
        [5.25, 5.9, -0.9],
        [6.9, 7.5, -1.25],
        [10.2, 10.0, -2.1],
      ],
      r: 0.45,
      end: 0.055,
    },
    {
      p: [
        [0.55, 5.2, -0.15],
        [0.6, 6.3, -1.1],
        [-0.5, 7.8, -2.2],
        [-1.2, 10.1, -3.2],
      ],
      r: 0.25,
      end: 0.06,
    },
    {
      p: [
        [0.58, 5, -0.18],
        [0.65, 6.0, -1.3],
        [1.7, 7.0, -2.0],
        [2.8, 7.9, -2.4],
        [3.3, 10, -2.8],
      ],
      r: 0.28,
      end: 0.05,
    },
    {
      p: [
        [4.7, 5.65, -0.7],
        [4.6, 6.8, -1.0],
        [4.0, 7.9, -1.4],
        [4.7, 9.3, -1.8],
        [5.1, 10.7, -2.1],
      ],
      r: 0.16,
      end: 0.03,
    },
    {
      p: [
        [2.6, 5.1, -0.25],
        [3.1, 5.6, -1.4],
        [4.1, 6.3, -2.35],
        [4.9, 7.3, -3],
      ],
      r: 0.14,
      end: 0.026,
    },
  ];
  const curves = main.map((b) => limb(b.p, b.r, b.end, 40));
  // Growth follows each parent limb; secondary branches do not share a central hub.
  function grow(start, dir, len, r, depth, seed) {
    const end = start.clone().addScaledVector(dir, len);
    const bend = new T.Vector3(
      (rng() - 0.5) * len * 0.3,
      (rng() - 0.3) * len * 0.23,
      (rng() - 0.5) * len * 0.3,
    );
    const mid = start.clone().lerp(end, 0.5).add(bend);
    const c = limb([start, mid, end], r, r * 0.23, 10);
    if (depth > 0) {
      const n = depth === 2 ? 3 : 3;
      for (let j = 0; j < n; j++) {
        const t = 0.42 + j * 0.25,
          st = c.getPoint(t),
          tangent = c.getTangent(t);
        const random = new T.Vector3(
          rng() - 0.5,
          (rng() - 0.35) * 0.8,
          rng() - 0.5,
        ).normalize();
        const nd = tangent
          .multiplyScalar(0.65)
          .addScaledVector(random, 0.7)
          .normalize();
        grow(
          st,
          nd,
          len * (0.44 + rng() * 0.18),
          r * 0.42,
          depth - 1,
          seed + j,
        );
      }
    } else tips.push({ p: end, dir, len });
  }
  curves.forEach((c, k) => {
    for (let j = 0; j < (k === 1 ? 12 : 8); j++) {
      const t = 0.53 + j / (k === 1 ? 28 : 20),
        start = c.getPoint(t),
        tangent = c.getTangent(t);
      const az = j * 2.399 + k * 1.6;
      const dir = tangent
        .multiplyScalar(0.35)
        .add(
          new T.Vector3(
            Math.cos(az) * 0.65,
            (j % 4 === 0 ? -0.25 : 0.2) + rng() * 0.25,
            Math.sin(az) * 0.75,
          ),
        )
        .normalize();
      grow(start, dir, 1.15 + rng() * 1.0, 0.038 + rng() * 0.02, 2, k * 17 + j);
    }
  });
  // Root buttresses disappear into dirt, with no cylinder cut at ground level.
  for (let k = 0; k < 7; k++) {
    const a = (k * 6.28) / 7;
    limb(
      [
        [0, 0.5, 0],
        [Math.cos(a) * 0.52, 0.08, Math.sin(a) * 0.5],
        [Math.cos(a) * 1.0, -0.08, Math.sin(a) * 0.95],
      ],
      0.19,
      0.02,
      14,
    );
  }
  const trunk = new T.Mesh(mergeGeometries(woody), bark);
  trunk.castShadow = trunk.receiveShadow = true;
  tree.add(trunk);
  // One folded, tapered broadleaf, reused as real geometry, with irregular rosettes.
  const leaf = new T.BufferGeometry();
  const lp = [],
    li = [];
  for (let j = 0; j <= 9; j++) {
    const t = j / 9,
      w = 0.046 * Math.pow(Math.sin(Math.PI * t), 0.68),
      y = 0.02 * Math.sin(Math.PI * t);
    lp.push(-w, y * 0.25, t * 0.225, 0, y, t * 0.225, w, y * 0.25, t * 0.225);
    if (j) {
      const k = (j - 1) * 3;
      li.push(
        k,
        k + 3,
        k + 1,
        k + 1,
        k + 3,
        k + 4,
        k + 1,
        k + 4,
        k + 2,
        k + 2,
        k + 4,
        k + 5,
      );
    }
  }
  leaf.setAttribute('position', new T.Float32BufferAttribute(lp, 3));
  leaf.setIndex(li);
  leaf.computeVertexNormals();
  const leafMat = new T.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.43,
    clearcoat: 0.22,
    clearcoatRoughness: 0.35,
    side: T.DoubleSide,
  });
  leafMat.onBeforeCompile = (s) => {
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
  };
  const leafyTips = tips.filter((t, i) => Math.sin(i * 5.67) > -0.15);
  const count = Math.floor(leafyTips.length * 78 * num('heroLeaves', 1));
  const leaves = new T.InstancedMesh(leaf, leafMat, count),
    dummy = new T.Object3D(),
    col = new T.Color();
  for (let i = 0; i < count; i++) {
    const tip = leafyTips[Math.floor(rng() * leafyTips.length)],
      a = rng() * 6.28,
      rr = Math.sqrt(rng()) * 0.26;
    dummy.position
      .copy(tip.p)
      .add(
        new T.Vector3(Math.cos(a) * rr, (rng() - 0.5) * 0.36, Math.sin(a) * rr),
      );
    dummy.rotation.set(rng() * 2.7, rng() * 6.28, rng() * 6.28);
    dummy.scale.set(1.25 + rng() * 0.6, 1, 1.0 + rng() * 0.75);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.22 + rng() * 0.055, 0.52 + rng() * 0.28, 0.02 + rng() * 0.04);
    leaves.setColorAt(i, col);
  }
  leaves.castShadow = leaves.receiveShadow = true;
  tree.add(leaves);
  const knot = new T.Group();
  knot.position.set(-0.13, 3.02, 0.63);
  knot.rotation.set(0.05, -0.26, -0.24);
  const knotGeo = new T.TorusGeometry(0.2, 0.065, 12, 40),
    kp = knotGeo.attributes.position;
  for (let i = 0; i < kp.count; i++) {
    const x = kp.getX(i),
      y = kp.getY(i),
      f = 1 + 0.05 * Math.sin(Math.atan2(y, x) * 3 + 0.3);
    kp.setXYZ(i, x * f, y * f, kp.getZ(i));
  }
  knotGeo.computeVertexNormals();
  const rim = new T.Mesh(knotGeo, bark);
  rim.scale.set(0.78, 1.3, 0.6);
  knot.add(rim);
  const cavity = new T.Mesh(
    new T.SphereGeometry(0.185, 24, 16),
    new T.MeshStandardMaterial({ color: 0x343129, roughness: 1 }),
  );
  cavity.scale.set(0.76, 1.25, 0.13);
  cavity.position.z = -0.019;
  knot.add(cavity);
  tree.add(knot);
  scene.add(tree);
  // A second, left-leaning trunk at the edge of the frame.
  const second = new T.Group();
  second.position.copy(V(tx - 2.8, ty - 0.9, edgeHeight(tx - 2.8)));
  const before = woody.length;
  limb(
    [
      [0, 0, 0],
      [-0.8, 1.8, 0],
      [-1.9, 3.8, 0.4],
      [-3.1, 5.7, 0.7],
      [-3.6, 8, 0.9],
    ],
    0.6,
    0.24,
    36,
  );
  const sm = new T.Mesh(woody[before], bark);
  sm.castShadow = sm.receiveShadow = true;
  second.add(sm);
  scene.add(second);
  return { tree, leaf, leafMat };
}

export function groundGrowth({ scene, V, roadY, edgeHeight, rng, num }) {
  // Real blade geometry along the verge, kept off the path and the road.
  const blade = new T.BufferGeometry();
  blade.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      [
        -0.011, 0, 0, 0.011, 0, 0, -0.006, 0.09, 0.012, 0.005, 0.09, 0.012,
        0.012, 0.18, 0.022,
      ],
      3,
    ),
  );
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  blade.computeVertexNormals();
  const mat = new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: 1 });
  const count = num('grassBlades', 55000),
    mesh = new T.InstancedMesh(blade, mat, count),
    o = new T.Object3D(),
    c = new T.Color();
  for (let i = 0; i < count; i++) {
    const x = -35 + rng() * 112,
      off = 5.74 + rng() * 2.72,
      y = roadY(x) + off;
    const patchiness =
      Math.sin(x * 1.4 + off * 0.8) + Math.cos(x * 0.65 - off * 3);
    o.position.copy(V(x, y, edgeHeight(x) + 0.008));
    o.rotation.set((rng() - 0.5) * 0.9, rng() * 6.28, 0);
    const sc = patchiness > 0 ? 0.1 + rng() * 0.25 : 0.02;
    o.scale.set(
      0.6 + rng() * 0.4,
      sc * num('grassHeight', 1),
      0.7 + rng() * 0.4,
    );
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    c.setHSL(0.17 + rng() * 0.1, 0.36 + rng() * 0.25, 0.15 + rng() * 0.14);
    mesh.setColorAt(i, c);
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);
}

export function rustyTree({ scene, V, heightAt, rng, num }) {
  const x = num('coniferX', 43),
    y = num('coniferY', -106),
    g = new T.Group();
  g.position.copy(V(x, y, heightAt(x, y)));
  const pos = [],
    col = [],
    idx = [],
    c = new T.Color();
  // Dense, drooping fine sprays with gaps between irregular ascending boughs.
  for (let b = 0; b < 170; b++) {
    const h = 3 + rng() * 16.5,
      az = b * 2.39996,
      len = (1.5 + Math.sin((h / 20) * Math.PI) * 2.1) * (0.6 + rng() * 0.7);
    const ox = Math.sin(h) * 0.55,
      oz = Math.cos(h * 1.7) * 0.5;
    for (let j = 0; j < 700; j++) {
      const t = Math.sqrt(rng()),
        r = len * t,
        rr = 0.24 + rng() * 0.6;
      const xx = ox + Math.cos(az) * r + (rng() - 0.5) * rr,
        zz = oz + Math.sin(az) * r + (rng() - 0.5) * rr;
      const yy =
        h +
        0.8 * Math.sin(t * Math.PI) -
        t * t * (0.8 + rng() * 1.8) +
        (rng() - 0.5) * rr;
      const a = rng() * 6.28,
        l = 0.16 + rng() * 0.28,
        ww = 0.025 + rng() * 0.045,
        k = pos.length / 3;
      pos.push(
        xx - Math.sin(a) * ww,
        yy,
        zz + Math.cos(a) * ww,
        xx + Math.sin(a) * ww,
        yy,
        zz - Math.cos(a) * ww,
        xx + Math.cos(a) * l,
        yy - l * 0.55,
        zz + Math.sin(a) * l,
      );
      c.setHSL(
        0.085 + rng() * 0.075,
        0.45 + rng() * 0.2,
        0.035 + rng() * 0.075,
      );
      for (let z = 0; z < 3; z++) col.push(c.r, c.g, c.b);
      idx.push(k, k + 1, k + 2);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const foliage = new T.Mesh(
    geo,
    new T.MeshStandardMaterial({
      vertexColors: true,
      side: T.DoubleSide,
      roughness: 1,
    }),
  );
  foliage.castShadow = foliage.receiveShadow = true;
  g.add(foliage);
  const trunk = new T.Mesh(
    new T.CylinderGeometry(0.08, 0.3, 18, 12),
    new T.MeshStandardMaterial({ color: 0x78694f, roughness: 1 }),
  );
  trunk.position.y = 9;
  trunk.castShadow = true;
  g.add(trunk);
  scene.add(g);
}
