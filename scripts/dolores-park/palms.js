import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original, untraced botanical approximations. Trunks use the credited CC0 material.
export function buildPalms({
  scene,
  treeData,
  V,
  load,
  num,
  hash,
  canvasTexture,
  rng,
  toSun,
}) {
  const texture = canvasTexture(512, 2048, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#829450';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    for (let y = 35; y < h - 20; y += 14) {
      const shape = Math.pow(Math.sin((y / h) * Math.PI), 0.6),
        len = shape * w * 0.49 * (0.88 + rng() * 0.12);
      for (const sign of [-1, 1]) {
        const l = 118 + rng() * 45;
        ctx.strokeStyle = `rgb(${l * 0.94},${l * 1.18},${l * 0.4})`;
        ctx.lineWidth = 5 + rng() * 2;
        ctx.beginPath();
        ctx.moveTo(w / 2, y);
        ctx.quadraticCurveTo(
          w / 2 + sign * len * 0.65,
          y - 20,
          w / 2 + sign * len,
          y + 40 + rng() * 22,
        );
        ctx.stroke();
      }
    }
  });
  const mat = new T.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.25,
    alphaToCoverage: true,
    side: T.DoubleSide,
    roughness: 0.64,
    vertexColors: true,
  });
  mat.onBeforeCompile = (s) => {
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
  };
  const trunkMap = load(
    '/archive/scenery/dolores/assets/palm_tree_bark_diff_1k.jpg',
  );
  trunkMap.repeat.set(2, 10);
  const trunkMat = new T.MeshStandardMaterial({
    map: trunkMap,
    roughness: 1,
    color: 0xb5a08a,
  });
  const deadMat = new T.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    alphaTest: 0.3,
    alphaToCoverage: true,
    side: T.DoubleSide,
    roughness: 1,
  });
  deadMat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
 float dryLum=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=vec3(.30,.16,.06)*dryLum*2.;`,
    );
  };
  function frond(i, N, dead = false) {
    const az = i * 2.39996,
      t = i / N,
      len = dead ? 3.5 + hash(i, 5) * 1.6 : 5.0 + hash(i, 10) * 1.8;
    const el = ((dead ? -25 - hash(i, 2) * 35 : 66 - t * 97) * Math.PI) / 180;
    const p = [],
      uv = [],
      idx = [],
      col = [],
      c = new T.Color();
    c.setHSL(0.19 + hash(i, 12) * 0.06, 0.35, 0.7 + hash(i, 3) * 0.23);
    for (let j = 0; j <= 20; j++) {
      const f = j / 20,
        a = Math.cos(el),
        out = len * (a * f + 0.1 * Math.sin(f * Math.PI)),
        up = len * (Math.sin(el) * f - (dead ? 0.9 : 0.56) * f * f);
      const wide =
        (dead ? 0.4 : 0.67) *
        Math.pow(Math.sin(Math.PI * Math.min(1, f + 0.012)), 0.67);
      const center = new T.Vector3(Math.cos(az) * out, up, Math.sin(az) * out),
        right = new T.Vector3(-Math.sin(az), 0, Math.cos(az));
      for (const k of [-1, 0, 1]) {
        const v = center.clone().addScaledVector(right, k * wide);
        v.y -= Math.abs(k) * wide * 0.22;
        p.push(...v);
        uv.push((k + 1) / 2, f);
        col.push(c.r, c.g, c.b);
      }
      if (j) {
        const k = (j - 1) * 3;
        idx.push(
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
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const phoenix = treeData.filter((t) => t.k === 'palm');
  const crown = mergeGeometries(
    Array.from({ length: 108 }, (_, i) => frond(i, 108)),
  );
  const dead = mergeGeometries(
    Array.from({ length: 22 }, (_, i) => frond(i, 22, true)),
  );
  const stem = new T.LatheGeometry(
    [
      new T.Vector2(0.52, 0),
      new T.Vector2(0.48, 0.1),
      new T.Vector2(0.4, 0.7),
      new T.Vector2(0.48, 0.88),
      new T.Vector2(0.71, 0.97),
      new T.Vector2(0.67, 1),
    ],
    16,
  );
  // Diamond-shaped retained leaf bases around the swollen crown.
  const boots = [];
  for (let j = 0; j < 7; j++)
    for (let i = 0; i < 14; i++) {
      const a = ((i + (j % 2) * 0.5) / 14) * Math.PI * 2,
        g = new T.OctahedronGeometry(0.18, 0);
      g.scale(0.82, 1.65, 0.42);
      g.rotateY(a);
      g.translate(
        Math.sin(a) * (0.57 + j * 0.018),
        j * 0.17 - 1.05,
        Math.cos(a) * (0.57 + j * 0.018),
      );
      boots.push(g);
    }
  const bootG = mergeGeometries(boots),
    bootMat = new T.MeshStandardMaterial({ color: 0x78654b, roughness: 1 });
  const insts = [
    new T.InstancedMesh(crown, mat, phoenix.length),
    new T.InstancedMesh(dead, deadMat, phoenix.length),
    new T.InstancedMesh(stem, trunkMat, phoenix.length),
    new T.InstancedMesh(bootG, bootMat, phoenix.length),
  ];
  const m = new T.Matrix4(),
    rot = new T.Quaternion();
  phoenix.forEach((p, i) => {
    const h = (12 + hash(p.x, p.y) * 7) * num('palmHeight', 0.92),
      sc = (0.8 + hash(p.y, p.x) * 0.38) * num('phoenixCrown', 1);
    rot.setFromAxisAngle(new T.Vector3(0, 1, 0), hash(p.x, 33) * 6.28);
    m.compose(V(p.x, p.y, p.z + h), rot, new T.Vector3(sc, sc, sc));
    insts[0].setMatrixAt(i, m);
    insts[1].setMatrixAt(i, m);
    insts[3].setMatrixAt(i, m);
    m.compose(V(p.x, p.y, p.z - 0.1), rot, new T.Vector3(sc, h, sc));
    insts[2].setMatrixAt(i, m);
  });
  insts.forEach((m) => {
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  });
  const fanParts = [],
    skirtParts = [];
  for (let i = 0; i < 38; i++) {
    const az = i * 2.39996,
      el = ((75 - (i / 38) * 108 + (hash(i, 19) - 0.5) * 14) * Math.PI) / 180,
      dir = new T.Vector3(
        Math.cos(az) * Math.cos(el),
        Math.sin(el),
        Math.sin(az) * Math.cos(el),
      ),
      right = new T.Vector3(-Math.sin(az), 0, Math.cos(az)).applyAxisAngle(
        dir,
        (hash(i, 29) - 0.5) * 1.4,
      );
    const center = dir.clone().multiplyScalar(0.55 + hash(i, 31) * 0.65),
      normal = new T.Vector3().crossVectors(dir, right),
      p = [],
      idx = [];
    const length = 1.02 + hash(i, 7) * 0.22;
    for (let j = 0; j <= 40; j++) {
      const a = -1.36 + (j / 40) * 2.72,
        rr = j % 2 ? length * 0.68 : length;
      const v = center
        .clone()
        .addScaledVector(dir, Math.cos(a) * rr)
        .addScaledVector(right, Math.sin(a) * rr)
        .addScaledVector(normal, j % 2 ? 0.11 : 0);
      p.push(...v);
      if (j) idx.push(41, j - 1, j);
    }
    p.push(...center);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    fanParts.push(g);
  }
  const fanCrown = mergeGeometries(fanParts),
    fans = treeData.filter((t) => t.k === 'palm2');
  const fanMat = new T.MeshStandardMaterial({
    color: 0x63833b,
    side: T.DoubleSide,
    roughness: 0.8,
  });
  const skirtMat = new T.MeshStandardMaterial({
    color: 0x7e6843,
    roughness: 1,
    side: T.DoubleSide,
  });
  for (let i = 0; i < 70; i++) {
    const a = i * 2.39996,
      hh = 1 + hash(i, 56) * 1.25,
      r = 0.5 + hash(i, 18) * 0.1,
      p = [
        Math.cos(a) * r,
        0,
        Math.sin(a) * r,
        Math.cos(a + 0.13) * r,
        0,
        Math.sin(a + 0.13) * r,
        Math.cos(a + 0.09) * r * 0.75,
        -hh,
        Math.sin(a + 0.09) * r * 0.75,
      ];
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    skirtParts.push(g);
  }
  const fm = [
    new T.InstancedMesh(fanCrown, fanMat, fans.length),
    new T.InstancedMesh(
      new T.CylinderGeometry(0.16, 0.24, 1, 10).translate(0, 0.5, 0),
      trunkMat,
      fans.length,
    ),
    new T.InstancedMesh(mergeGeometries(skirtParts), skirtMat, fans.length),
  ];
  fans.forEach((p, i) => {
    const h = (17 + hash(p.x, p.y) * 7) * num('palmHeight', 0.92),
      ss = num('fanCrown', 0.86);
    rot.setFromAxisAngle(new T.Vector3(0, 1, 0), hash(p.x, 11) * 6.28);
    m.compose(V(p.x, p.y, p.z + h), rot, new T.Vector3(ss, ss, ss));
    fm[0].setMatrixAt(i, m);
    fm[2].setMatrixAt(i, m);
    m.compose(V(p.x, p.y, p.z), rot, new T.Vector3(1, h, 1));
    fm[1].setMatrixAt(i, m);
  });
  fm.forEach((m) => {
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  });
}
