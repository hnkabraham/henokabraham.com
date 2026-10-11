// Original procedural architecture; no photographic facade textures.
// Local house axes: X across the lot, Y up, Z toward the rear (south).
// All finish variation is geometry, vertex colour, or ordinary texture maps.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const palettes = [
  {
    name: 'sage / ivory / oxblood',
    body: '#8b9c83',
    trim: '#eee0c3',
    accent: '#663c38',
    dark: '#384947',
    gold: '#b49a59',
  },
  {
    name: 'dusty blue / cream / navy',
    body: '#718b9b',
    trim: '#eee0c3',
    accent: '#364e60',
    dark: '#34454b',
    gold: '#b49a59',
  },
  {
    name: 'butter / ivory / plum',
    body: '#c8b67d',
    trim: '#f1e5cd',
    accent: '#624557',
    dark: '#514849',
    gold: '#c4a65e',
  },
  {
    name: 'deep teal / parchment / copper',
    body: '#527c79',
    trim: '#eee0c3',
    accent: '#97674d',
    dark: '#304e4d',
    gold: '#b49a59',
  },
  {
    name: 'rose / bone / oxblood',
    body: '#ae8581',
    trim: '#f1e5cd',
    accent: '#663c38',
    dark: '#5c4847',
    gold: '#c4a65e',
  },
  {
    name: 'celadon / cream / forest',
    body: '#a7b4a1',
    trim: '#eee0c3',
    accent: '#3e6055',
    dark: '#3f514c',
    gold: '#b49a59',
  },
];
export const houseTreeXs = [18, 37, 61];
const types = ['Italianate', 'Stick-Eastlake', 'Queen Anne', 'Edwardian'];
const hash = (a, b = 0) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const color = (hex, gain = 1) => new T.Color(hex).multiplyScalar(gain);

// Shared layout keeps driveway curb cuts aligned with the modelled garages.
function houseLayout(buildings, roadY) {
  const lots = [];
  const angle = Math.atan2(roadY(40) - roadY(0), 40),
    ca = Math.cos(angle),
    sa = Math.sin(angle);
  const candidates = buildings
    .map((b) => {
      const u = b.p.map(([x, y]) => x * ca + y * sa),
        v = b.p.map(([x, y]) => y * ca - x * sa);
      return {
        b,
        u0: Math.min(...u),
        u1: Math.max(...u),
        front: Math.max(...v),
        back: Math.min(...v),
      };
    })
    .sort((a, b) => a.u0 - b.u0);
  for (const item of candidates) {
    const count = Math.max(1, Math.round((item.u1 - item.u0) / 9.3));
    for (let i = 0; i < count; i++) {
      const u = item.u0 + ((item.u1 - item.u0) * (i + 0.5)) / count;
      const v = item.front - 0.38;
      lots.push({
        x: u * ca - v * sa,
        y: u * sa + v * ca,
        w: (item.u1 - item.u0) / count - 0.14,
        depth: Math.min(20, item.front - item.back),
        original: item.b,
      });
    }
  }
  return { lots, angle };
}

export function garageCutPositions(buildings, roadY) {
  const { lots, angle } = houseLayout(buildings, roadY);
  return lots.flatMap((lot, index) =>
    index % 4 !== 2 && index % 3 !== 0
      ? [lot.x + lot.w * (lot.w > 10 ? 0.31 : 0.19) * Math.cos(angle)]
      : [],
  );
}

export function buildHouses({
  scene,
  buildings,
  roadY,
  roadHeight,
  windowMaterials,
  canvasTexture,
  detail = true,
}) {
  const row = new T.Group();
  row.name = '20th Street painted Victorians';
  const grain = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f1eb';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(80,68,51,${0.018 + hash(i, 1) * 0.04})`;
      ctx.fillRect(hash(i, 2) * w, hash(i, 3) * h, 1 + hash(i, 4) * 22, 0.4);
    }
    ctx.fillStyle = 'rgba(60,53,40,.3)';
    ctx.fillRect(0, h - 2, w, 2);
    ctx.fillStyle = 'rgba(255,255,245,.28)';
    ctx.fillRect(0, 0, w, 2);
  });
  const stain = canvasTexture(64, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(36,31,24,0)');
    g.addColorStop(0.78, 'rgba(36,31,24,.05)');
    g.addColorStop(1, 'rgba(36,31,24,.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(48,43,35,${hash(i, 11) * 0.08})`;
      ctx.fillRect(
        hash(i, 12) * w,
        h * (0.6 + hash(i, 13) * 0.35),
        0.6 + hash(i, 14) * 2,
        h,
      );
    }
  });
  const paint = new T.MeshStandardMaterial({
    map: grain,
    vertexColors: true,
    roughness: 0.78,
  });
  paint.name = 'Painted wood / subtle grain';
  const stone = new T.MeshStandardMaterial({
    map: grain,
    vertexColors: true,
    roughness: 0.97,
  });
  stone.name = 'Stone, brick and roof';
  const glass = new T.MeshPhysicalMaterial({
    color: '#263d49',
    metalness: 0.48,
    roughness: 0.19,
    clearcoat: 0.4,
  });
  glass.name = 'Window glass (environment optional)';
  windowMaterials.push(glass);
  const grime = new T.MeshStandardMaterial({
    map: stain,
    transparent: true,
    depthWrite: false,
    roughness: 1,
  });
  grime.name = 'Subtle runoff';
  const parts = new Map();
  const repeated = new Map();
  const unit = new T.BoxGeometry(1, 1, 1);
  const board = unit.clone();
  // Back and upper faces are hidden by the wall / next overlapping board.
  board.setIndex(
    [0, 1, 3, 5].flatMap((face) =>
      Array.from(unit.index.array.slice(face * 6, face * 6 + 6)),
    ),
  );
  board.clearGroups();
  const bracketShape = new T.Shape();
  bracketShape.moveTo(0, 0);
  bracketShape.lineTo(0.17, 0);
  bracketShape.lineTo(0.17, -0.08);
  bracketShape.bezierCurveTo(0.12, -0.14, 0.06, -0.2, 0.04, -0.34);
  bracketShape.lineTo(-0.05, -0.4);
  bracketShape.lineTo(-0.13, -0.36);
  bracketShape.lineTo(-0.13, 0);
  const bracketGeo = new T.ExtrudeGeometry(bracketShape, {
    depth: 0.13,
    bevelEnabled: false,
    curveSegments: 5,
  });
  // Profile XY -> depth/height; extrusion becomes bracket width.
  bracketGeo.rotateY(Math.PI / 2);
  bracketGeo.translate(-0.065, 0, -0.09);
  const balusterGeo = new T.LatheGeometry(
    [
      [0.033, 0],
      [0.033, 0.06],
      [0.022, 0.1],
      [0.045, 0.17],
      [0.028, 0.24],
      [0.02, 0.43],
      [0.038, 0.49],
      [0.024, 0.55],
      [0.032, 0.6],
    ].map((p) => new T.Vector2(...p)),
    6,
  );
  const columnGeo = new T.LatheGeometry(
    [
      [0.11, 0],
      [0.11, 0.08],
      [0.085, 0.13],
      [0.071, 0.23],
      [0.062, 1.96],
      [0.1, 2.02],
      [0.1, 2.1],
      [0.12, 2.14],
      [0.12, 2.25],
      [0.14, 2.28],
    ].map((p) => new T.Vector2(...p)),
    10,
  );
  const mould = new T.Object3D();
  function matrix(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rz = 0) {
    mould.position.set(x, y, z);
    mould.rotation.set(0, ry, rz);
    mould.scale.set(sx, sy, sz);
    mould.updateMatrix();
    return mould.matrix.clone();
  }
  function add(geo, mat, shade, frame, local = new T.Matrix4()) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(frame.clone().multiply(local));
    const c = shade?.isColor ? shade : new T.Color(shade || '#ffffff');
    if (mat.vertexColors) {
      const values = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < values.length; i += 3) {
        values[i] = c.r;
        values[i + 1] = c.g;
        values[i + 2] = c.b;
      }
      g.setAttribute('color', new T.BufferAttribute(values, 3));
    }
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(g);
  }
  function box(frame, x, y, z, w, h, d, shade, mat = paint, ry = 0, rz = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    add(unit, mat, shade, frame, matrix(x, y, z, w, h, d, ry, rz));
  }
  function repeat(kind, frame, x, y, z, w, h, d, shade, ry = 0, rz = 0) {
    const key = kind + shade;
    if (!repeated.has(key)) repeated.set(key, { kind, shade, matrices: [] });
    repeated
      .get(key)
      .matrices.push(frame.clone().multiply(matrix(x, y, z, w, h, d, ry, rz)));
  }
  function beam(frame, a, b, width, depth, shade) {
    const av = new T.Vector3(...a),
      bv = new T.Vector3(...b),
      dir = bv.clone().sub(av);
    const m = new T.Matrix4().compose(
      av.clone().add(bv).multiplyScalar(0.5),
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        dir.clone().normalize(),
      ),
      new T.Vector3(width, dir.length(), depth),
    );
    add(unit, paint, shade, frame, m);
  }
  function panel(frame, x, y, z, w, h, p, inset = p.accent) {
    box(frame, x, y, z, w, h, 0.045, inset);
    for (const dx of [-w / 2, w / 2])
      box(frame, x + dx, y, z - 0.028, 0.045, h + 0.035, 0.065, p.trim);
    for (const dy of [-h / 2, h / 2])
      box(frame, x, y + dy, z - 0.028, w + 0.045, 0.045, 0.065, p.trim);
  }
  function siding(
    frame,
    w,
    bottom,
    top,
    p,
    openings = [],
    z = 0,
    seed = 0,
    course = 0.145,
  ) {
    for (let y = bottom; y < top - 0.01; y += course) {
      const bh = Math.min(course, top - y);
      let spans = [[-w / 2, w / 2]];
      for (const o of openings)
        if (y < o.y + o.h / 2 + 0.04 && y + bh > o.y - o.h / 2 - 0.04) {
          spans = spans
            .flatMap(([a, b]) =>
              o.x + o.w / 2 <= a || o.x - o.w / 2 >= b
                ? [[a, b]]
                : [
                    [a, Math.max(a, o.x - o.w / 2)],
                    [Math.min(b, o.x + o.w / 2), b],
                  ],
            )
            .filter(([a, b]) => b - a > 0.005);
        }
      for (const [a, b] of spans) {
        // Overlapping boards, proud lower edges and real shadow lines.
        const m = matrix((a + b) / 2, y + bh / 2, z + 0.019);
        m.multiply(new T.Matrix4().makeRotationX(-0.115)).scale(
          new T.Vector3(b - a, bh + 0.012, 0.043),
        );
        add(
          board,
          paint,
          color(p.body, 0.94 + hash(y * 11, seed) * 0.09),
          frame,
          m,
        );
      }
    }
  }
  function cornice(frame, x, y, z, w, p, heavy = true) {
    box(frame, x, y - 0.27, z + 0.055, w, 0.34, 0.18, p.accent);
    for (const [dy, hh, depth, shade] of [
      [-0.42, 0.055, 0.22, p.gold],
      [-0.34, 0.08, 0.25, p.trim],
      [-0.06, 0.1, 0.4, p.trim],
      [0.05, 0.11, 0.53, p.trim],
      [0.14, 0.045, 0.58, p.accent],
    ])
      box(frame, x, y + dy, z - depth / 2 + 0.1, w + 0.18, hh, depth, shade);
    for (let dx = -w / 2 + 0.2; dx < w / 2 - 0.1; dx += 0.28)
      repeat(
        'box',
        frame,
        x + dx,
        y - 0.155,
        z - 0.13,
        0.074,
        0.13,
        0.14,
        p.trim,
      );
    if (heavy)
      for (let dx = -w / 2 + 0.24; dx < w / 2 - 0.1; dx += 0.61)
        repeat(
          'bracket',
          frame,
          x + dx,
          y - 0.08,
          z - 0.13,
          1.15,
          1.05,
          1.2,
          p.trim,
        );
  }
  function hood(frame, x, y, z, w, p, type) {
    if (type === 0) {
      const s = new T.Shape(),
        r = w / 2 + 0.12;
      s.moveTo(-r, 0);
      s.quadraticCurveTo(0, 0.42, r, 0);
      s.lineTo(r, 0.1);
      s.quadraticCurveTo(0, 0.58, -r, 0.1);
      s.closePath();
      const g = new T.ExtrudeGeometry(s, {
        depth: 0.14,
        bevelEnabled: false,
        curveSegments: 10,
      });
      add(g, paint, p.trim, frame, matrix(x, y + 0.04, z - 0.22));
      g.dispose();
      box(frame, x, y + 0.13, z - 0.28, 0.14, 0.2, 0.1, p.gold);
    } else if (type === 2) {
      beam(
        frame,
        [x - w / 2 - 0.13, y, z - 0.12],
        [x, y + 0.35, z - 0.12],
        0.08,
        0.16,
        p.trim,
      );
      beam(
        frame,
        [x, y + 0.35, z - 0.12],
        [x + w / 2 + 0.13, y, z - 0.12],
        0.08,
        0.16,
        p.trim,
      );
      box(frame, x, y, z - 0.13, w + 0.35, 0.085, 0.22, p.accent);
    } else {
      box(frame, x, y + 0.07, z - 0.12, w + 0.33, 0.13, 0.22, p.trim);
      box(frame, x, y + 0.16, z - 0.14, w + 0.41, 0.045, 0.26, p.accent);
    }
  }
  function window(frame, o, p, type, seed = 0) {
    const { x, y, w, h } = o,
      z = o.z || 0;
    // Recessed glass; open siding aperture, deep dark jambs, separate sashes.
    box(frame, x, y, z + 0.15, w + 0.06, h + 0.08, 0.075, p.dark);
    box(frame, x, y, z + 0.1, w - 0.075, h - 0.08, 0.025, '#ffffff', glass);
    for (const dx of [-w / 2, w / 2]) {
      box(frame, x + dx, y, z + 0.035, 0.065, h + 0.16, 0.24, p.dark);
      box(frame, x + dx, y, z - 0.068, 0.115, h + 0.26, 0.12, p.trim);
      box(frame, x + dx * 1.13, y, z - 0.086, 0.026, h + 0.3, 0.065, p.accent);
    }
    for (const dy of [-h / 2, h / 2])
      box(frame, x, y + dy, z - 0.052, w + 0.22, 0.105, 0.14, p.trim);
    for (const dx of [-w / 2 + 0.065, w / 2 - 0.065])
      repeat('box', frame, x + dx, y, z + 0.015, 0.038, h - 0.12, 0.04, p.trim);
    for (const dy of [-h / 2 + 0.065, 0.045, h / 2 - 0.065])
      repeat(
        'box',
        frame,
        x,
        y + dy,
        z + 0.005,
        w - 0.12,
        0.047,
        0.046,
        p.trim,
      );
    if (type === 1 || type === 2) {
      for (const dx of [-w * 0.17, w * 0.17])
        repeat(
          'box',
          frame,
          x + dx,
          y + h * 0.255,
          z + 0.016,
          0.018,
          h * 0.42,
          0.025,
          p.trim,
        );
      repeat(
        'box',
        frame,
        x,
        y + h * 0.26,
        z + 0.012,
        w - 0.15,
        0.019,
        0.028,
        p.trim,
      );
    }
    box(frame, x, y - h / 2 - 0.12, z - 0.1, w + 0.32, 0.09, 0.32, p.trim);
    box(frame, x, y - h / 2 - 0.22, z - 0.028, w + 0.1, 0.1, 0.09, p.accent);
    if (seed % 3 !== 0) {
      const drop = h * (0.13 + hash(seed, 3) * 0.3);
      box(
        frame,
        x,
        y + h / 2 - drop / 2 - 0.08,
        z + 0.073,
        w - 0.17,
        drop,
        0.006,
        color('#b7b1a0', 0.55 + hash(seed, 7) * 0.16),
      );
      for (let yy = 0; yy < drop; yy += 0.06)
        box(
          frame,
          x,
          y + h / 2 - yy - 0.09,
          z + 0.064,
          w - 0.18,
          0.008,
          0.006,
          '#6f776f',
        );
    } else {
      for (const side of [-1, 1])
        for (let i = 0; i < 4; i++)
          box(
            frame,
            x + side * (w * 0.33 + i * 0.025),
            y - 0.1,
            z + 0.061,
            0.039,
            h - 0.25,
            0.009,
            color('#9bada9', 0.52 + hash(i, seed) * 0.13),
          );
    }
    if (o.hood !== false) hood(frame, x, y + h / 2 + 0.09, z, w, p, type);
    // A soft alpha texture under sills, ordinary PBR material on a decal plane.
    add(
      new T.PlaneGeometry(w + 0.22, 0.23).rotateY(Math.PI),
      grime,
      null,
      frame,
      matrix(x, y - h / 2 - 0.27, z - 0.036),
    );
  }
  function prism(frame, outline, y, h, p, mat = paint) {
    const shape = new T.Shape(outline.map(([x, z]) => new T.Vector2(x, -z)));
    const g = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    add(g, mat, p, frame, matrix(0, y, 0));
    g.dispose();
  }
  function bay(frame, x, base, top, bw, p, type, floors, seed) {
    const square = type === 1,
      fw = square ? bw : bw * 0.54,
      depth = square ? 0.7 : 0.93;
    const points = [
      [-bw / 2, 0],
      [-fw / 2, -depth],
      [fw / 2, -depth],
      [bw / 2, 0],
    ];
    if (square) {
      points[1][0] = -bw / 2;
      points[2][0] = bw / 2;
    }
    const bf = frame.clone().multiply(matrix(x, 0, 0));
    const outline = [...points, [bw / 2, 0.14], [-bw / 2, 0.14]];
    for (let side = 0; side < 3; side++) {
      const [ax, az] = points[side],
        [bx, bz] = points[side + 1];
      const length = Math.hypot(bx - ax, bz - az),
        angle = -Math.atan2(bz - az, bx - ax);
      const f = bf
        .clone()
        .multiply(matrix((ax + bx) / 2, 0, (az + bz) / 2, 1, 1, 1, angle));
      const opens = [];
      for (let i = 0; i < floors; i++) {
        if (square && side === 1)
          for (const xx of [-length * 0.25, length * 0.25])
            opens.push({
              x: xx,
              y: base + 1.6 + i * 3.15,
              w: length / 2 - 0.27,
              h: 1.92,
              z: 0,
            });
        else
          opens.push({
            x: 0,
            y: base + 1.6 + i * 3.15,
            w: Math.max(0.36, length - 0.34),
            h: 1.92,
            z: 0,
          });
      }
      siding(f, length, base, top, p, opens, 0, seed + side);
      opens.forEach((o, i) => window(f, o, p, type, seed + side + i * 4));
      for (let i = 0; i < floors; i++) {
        panel(
          f,
          0,
          base + 0.34 + i * 3.15,
          -0.06,
          length - 0.19,
          0.36,
          p,
          p.body,
        );
        if (type === 1)
          box(
            f,
            0,
            base + 0.34 + i * 3.15,
            -0.102,
            0.2,
            0.2,
            0.04,
            p.gold,
            paint,
            0,
            Math.PI / 4,
          );
      }
      for (const xx of [-length / 2 + 0.045, length / 2 - 0.045])
        box(f, xx, (base + top) / 2, -0.07, 0.095, top - base, 0.13, p.trim);
    }
    for (let i = 0; i <= floors; i++) {
      const y = i === floors ? top : base + i * 3.15;
      const wide = outline.map(([px, pz]) => [px * 1.035, pz - 0.025]);
      prism(bf, wide, y, 0.13, p.trim);
      prism(bf, outline, y + 0.14, 0.065, p.accent);
    }
    prism(bf, outline, top + 0.22, 0.1, p.dark, stone);
  }
  function steps(frame, x, base, p, porch = false) {
    const count = Math.round(base / 0.17),
      depth = 0.26,
      start = -0.4 - count * depth;
    for (let i = 0; i < count; i++) {
      box(
        frame,
        x,
        ((i + 1) * base) / count / 2,
        start + (i + 0.5) * depth,
        1.45,
        ((i + 1) * base) / count,
        depth + 0.012,
        '#9c998c',
        stone,
      );
      box(
        frame,
        x,
        ((i + 1) * base) / count + 0.012,
        start + (i + 0.5) * depth - 0.025,
        1.5,
        0.036,
        depth + 0.055,
        '#b5b0a0',
        stone,
      );
    }
    box(frame, x, base / 2, -0.18, 1.5, base, 0.55, '#858779', stone);
    for (const side of [-1, 1]) {
      const xx = x + side * 0.69;
      beam(
        frame,
        [xx, 0.9, start + 0.08],
        [xx, base + 0.9, -0.3],
        0.045,
        0.045,
        p.dark,
      );
      for (let i = 0; i <= count; i += 2)
        box(
          frame,
          xx,
          (i * base) / count + 0.43,
          start + i * depth,
          0.032,
          0.86,
          0.032,
          p.dark,
        );
      for (const [yy, zz] of [
        [0, start + 0.08],
        [base, -0.3],
      ]) {
        box(frame, xx, yy + 0.48, zz, 0.1, 0.96, 0.1, p.accent);
        box(frame, xx, yy + 0.99, zz, 0.15, 0.07, 0.15, p.trim);
        const ball = new T.SphereGeometry(0.077, 8, 5);
        add(ball, paint, p.gold, frame, matrix(xx, yy + 1.07, zz));
        ball.dispose();
      }
    }
    if (porch) {
      for (const xx of [x - 0.85, x + 0.85]) {
        repeat('column', frame, xx, base + 0.12, -0.7, 1, 1, 1, p.trim);
        for (const yy of [base + 0.12, base + 2.22])
          box(frame, xx, yy, -0.7, 0.28, 0.2, 0.28, p.trim);
      }
      box(frame, x, base + 2.48, -0.38, 2.05, 0.22, 1.26, p.accent);
      cornice(frame, x, base + 2.7, -0.72, 2.1, p, false);
      for (let xx = x - 0.8; xx < x + 0.9; xx += 0.18)
        repeat('baluster', frame, xx, base + 2.87, -0.81, 1, 0.75, 1, p.trim);
      box(frame, x, base + 3.34, -0.81, 2.1, 0.075, 0.13, p.trim);
    }
  }
  function door(frame, x, base, p, number, porch = false) {
    box(frame, x, base + 1.15, 0.18, 1.35, 2.5, 0.38, p.dark);
    box(frame, x, base + 1.06, 0.1, 1.1, 2.1, 0.08, p.accent);
    for (const side of [-1, 1])
      box(frame, x + side * 0.72, base + 1.2, -0.08, 0.14, 2.63, 0.25, p.trim);
    box(frame, x, base + 2.48, -0.07, 1.58, 0.16, 0.26, p.trim);
    box(frame, x, base + 2.27, 0.035, 1.09, 0.26, 0.025, '#ffffff', glass);
    for (const dx of [-0.27, 0.27])
      for (const yy of [0.38, 1.15, 1.78])
        panel(
          frame,
          x + dx,
          base + yy,
          0.02,
          0.38,
          yy === 1.15 ? 0.67 : 0.34,
          p,
          p.accent,
        );
    box(frame, x + 0.39, base + 1.05, -0.064, 0.025, 0.18, 0.05, p.gold);
    // Brass number plaques, drawn once into the small shared atlas below.
    const uv0 = (number % 32) / 32;
    const g = new T.PlaneGeometry(0.49, 0.13);
    g.rotateY(Math.PI);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv0 + uv.getX(i) / 32);
    add(g, numberMaterial, null, frame, matrix(x, base + 2.64, -0.13));
    g.dispose();
    steps(frame, x, base, p, porch);
  }
  const numberMap = canvasTexture(1024, 32, (ctx, w, h) => {
    ctx.fillStyle = '#2b3433';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 14px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d4bd7c';
    for (let i = 0; i < 32; i++)
      ctx.fillText(String(3820 + i * 2), i * 32 + 16, h / 2);
  });
  const numberMaterial = new T.MeshStandardMaterial({
    map: numberMap,
    roughness: 0.7,
  });
  function garage(frame, x, width, p) {
    box(frame, x, 1.06, 0.09, width + 0.25, 2.25, 0.22, p.dark);
    box(frame, x, 1.08, -0.034, width, 2.05, 0.12, color(p.accent, 0.87));
    for (const side of [-1, 1])
      box(
        frame,
        x + side * (width / 2 + 0.08),
        1.11,
        -0.12,
        0.14,
        2.27,
        0.19,
        p.trim,
      );
    box(frame, x, 2.23, -0.12, width + 0.34, 0.17, 0.2, p.trim);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) {
        const xx = x - width / 2 + ((col + 0.5) * width) / 4,
          yy = 0.32 + row * 0.48;
        panel(
          frame,
          xx,
          yy,
          -0.102,
          width / 4 - 0.13,
          0.34,
          { ...p, trim: p.accent },
          row === 3 ? p.dark : color(p.accent, 1.07),
        );
        if (row === 3)
          box(
            frame,
            xx,
            yy,
            -0.14,
            width / 4 - 0.23,
            0.23,
            0.018,
            '#ffffff',
            glass,
          );
      }
    for (const xx of [x - 0.1, x + 0.1])
      box(frame, xx, 1.12, -0.18, 0.023, 0.17, 0.033, p.gold);
  }
  function gable(frame, x, y, z, width, rise, p, seed) {
    const s = new T.Shape();
    s.moveTo(-width / 2, 0);
    s.lineTo(width / 2, 0);
    s.lineTo(0, rise);
    s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false });
    add(g, paint, p.accent, frame, matrix(x, y, z));
    g.dispose();
    // Individual round-bottom shingles in staggered courses.
    for (let yy = 0.1; yy < rise - 0.14; yy += 0.19) {
      const half = (width / 2) * (1 - (yy + 0.2) / rise) - 0.1;
      for (let xx = -half + 0.11; xx < half; xx += 0.235) {
        const sh = new T.Shape();
        sh.moveTo(-0.113, 0.2);
        sh.lineTo(0.113, 0.2);
        sh.lineTo(0.113, 0.035);
        sh.quadraticCurveTo(0, -0.1, -0.113, 0.035);
        sh.closePath();
        const gg = new T.ShapeGeometry(sh, 4);
        gg.rotateY(Math.PI);
        add(
          gg,
          paint,
          color(seed % 2 ? p.body : p.gold, 0.82 + hash(xx, yy) * 0.2),
          frame,
          matrix(x + xx, y + yy, z - 0.04 - (rise - yy) * 0.004),
        );
        gg.dispose();
      }
    }
    for (const dz of [-0.1, 3.0]) {
      beam(
        frame,
        [x - width / 2 - 0.12, y, z + dz],
        [x, y + rise + 0.13, z + dz],
        0.16,
        0.2,
        p.trim,
      );
      beam(
        frame,
        [x, y + rise + 0.13, z + dz],
        [x + width / 2 + 0.12, y, z + dz],
        0.16,
        0.2,
        p.trim,
      );
    }
    for (const side of [-1, 1]) {
      const len = Math.hypot(width / 2, rise),
        ang = -side * Math.atan2(rise, width / 2);
      box(
        frame,
        x + (side * width) / 4,
        y + rise / 2 + 0.07,
        z + 1.48,
        len + 0.32,
        0.1,
        3.4,
        '#485354',
        stone,
        0,
        ang,
      );
    }
    box(frame, x, y + rise - 0.15, z - 0.17, 0.09, 0.75, 0.1, p.trim);
    for (let dx = -width * 0.25; dx <= width * 0.25; dx += 0.22) {
      const h = Math.max(0.05, rise * (1 - Math.abs(dx) / (width / 2)) - 0.67);
      box(frame, x + dx, y + 0.67 + h / 2, z - 0.13, 0.035, h, 0.065, p.trim);
    }
    beam(
      frame,
      [x - width * 0.32, y + 0.67, z - 0.15],
      [x + width * 0.32, y + 0.67, z - 0.15],
      0.06,
      0.08,
      p.trim,
    );
  }

  const { lots, angle } = houseLayout(buildings, roadY);
  const report = [];
  lots.forEach((lot, index) => {
    const type = index % 4;
    const p = palettes[index % palettes.length];
    const frame = matrix(
      lot.x,
      roadHeight(lot.x) + 0.12,
      -lot.y,
      1,
      1,
      1,
      angle,
    );
    const width = lot.w;
    const hasGarage = type !== 2 && index % 3 !== 0;
    const floors = type === 3 ? 3 : 2,
      base = hasGarage ? 2.4 : type === 2 ? 1.55 : type === 1 ? 1.35 : 1.75;
    const top = base + floors * 3.15 + 0.22;
    const depth = lot.depth;
    const twin = width > 10;
    const entryX = twin ? 0 : -width * 0.31,
      bayX = width * (twin ? 0.31 : 0.19),
      bayW = Math.min(3.25, width * 0.47);
    const upper = [];
    for (let i = 0; i < floors; i++)
      upper.push({ x: entryX, y: base + 1.6 + i * 3.15, w: 1.12, h: 1.92 });
    const openings = [
      ...upper,
      { x: entryX, y: base + 1.15, w: 1.48, h: 2.54 },
    ];
    if (hasGarage)
      openings.push({
        x: bayX,
        y: 1.08,
        w: Math.min(3.4, width * 0.49) + 0.22,
        h: 2.28,
      });
    else
      for (const xx of twin
        ? [-bayX - 0.67, -bayX + 0.67, bayX - 0.67, bayX + 0.67]
        : [bayX - 0.67, bayX + 0.67])
        openings.push({ x: xx, y: base * 0.44, w: 0.8, h: base * 0.56 });
    report.push({
      type: types[type],
      palette: p.name,
      x: +lot.x.toFixed(2),
      y: +lot.y.toFixed(2),
      width: +width.toFixed(2),
      height: +top.toFixed(2),
      garage: hasGarage,
    });
    if (!detail) {
      box(frame, 0, top / 2, depth / 2, width, top, depth, p.body);
      return;
    }
    // The walls have real holes: the window glass is behind the siding plane.
    siding(frame, width, -0.45, top, p, openings, 0, index);
    for (const side of [-1, 1]) {
      const wall = frame
        .clone()
        .multiply(
          matrix(
            (side * width) / 2,
            0,
            depth / 2,
            1,
            1,
            1,
            side === 1 ? -Math.PI / 2 : Math.PI / 2,
          ),
        );
      const service = [];
      for (let i = 0; i < floors; i++)
        for (const xx of [side === 1 ? -depth / 2 + 1.35 : depth / 2 - 1.35, 0])
          service.push({
            x: xx,
            y: base + 1.5 + i * 3.15,
            w: 0.74,
            h: 1.34,
            hood: false,
          });
      siding(wall, depth, -0.45, top, p, service, 0.015, index + side, 0.265);
      service.forEach((o, i) => window(wall, o, p, 3, i));
      box(
        wall,
        -depth / 2 + 0.24,
        top / 2,
        -0.085,
        0.065,
        top,
        0.065,
        p.accent,
      );
    }
    box(frame, 0, top / 2, depth, width, top, 0.16, p.body);
    box(frame, 0, top + 0.01, depth / 2, width, 0.16, depth, p.dark, stone);
    for (const side of [-1, 1]) {
      box(
        frame,
        side * (width / 2 - 0.08),
        top + 0.24,
        depth / 2,
        0.17,
        0.48,
        depth,
        p.body,
      );
      box(
        frame,
        side * (width / 2 - 0.08),
        top + 0.49,
        depth / 2,
        0.26,
        0.075,
        depth + 0.15,
        p.trim,
      );
      box(
        frame,
        side * (width / 2 - 0.1),
        (top + base) / 2,
        -0.07,
        0.16,
        top - base,
        0.13,
        p.trim,
      );
    }
    for (let i = 0; i < floors; i++) {
      const y = base + i * 3.15;
      box(frame, 0, y - 0.08, -0.1, width, 0.13, 0.2, p.trim);
      box(frame, 0, y + 0.06, -0.06, width, 0.065, 0.11, p.accent);
      if (i > 0) window(frame, upper[i], p, type, index + i);
    }
    // Entry occupies the first-floor flat window position.
    door(frame, entryX, base, p, index, type === 2 || type === 0);
    bay(frame, bayX, base, top - 0.42, bayW, p, type, floors, index);
    if (twin)
      bay(frame, -bayX, base, top - 0.42, bayW, p, type, floors, index + 2);
    if (!hasGarage)
      for (const xx of twin
        ? [-bayX - 0.67, -bayX + 0.67, bayX - 0.67, bayX + 0.67]
        : [bayX - 0.67, bayX + 0.67])
        window(
          frame,
          { x: xx, y: base * 0.44, w: 0.8, h: base * 0.54, hood: false },
          p,
          3,
          index,
        );
    else garage(frame, bayX, Math.min(3.4, width * 0.49), p);
    if (type === 2) {
      gable(frame, bayX, top - 0.22, -0.92, bayW + 1.15, 2.65, p, index);
      cornice(frame, -width * 0.28, top - 0.08, 0, width * 0.43, p, false);
    } else {
      cornice(frame, 0, top + 0.18, -0.08, width, p, true);
      if (type === 1) {
        for (let xx = -width / 2 + 0.3; xx < width / 2 - 0.1; xx += 0.23)
          repeat(
            'baluster',
            frame,
            xx,
            top + 0.38,
            -0.05,
            0.75,
            0.64,
            0.75,
            p.trim,
          );
        box(frame, 0, top + 0.79, -0.07, width + 0.18, 0.09, 0.19, p.accent);
        gable(frame, bayX, top + 0.37, -0.23, bayW + 1.0, 1.4, p, index);
      }
      if (type === 0) {
        panel(frame, 0, top + 0.6, 0.02, 1.55, 0.54, p, p.body);
        cornice(frame, 0, top + 1.02, 0, 1.8, p, false);
      }
    }
    if (type === 1)
      for (const xx of [entryX - 0.79, entryX + 0.79]) {
        box(frame, xx, base + 3.55, -0.09, 0.07, 5.8, 0.09, p.accent);
        for (let i = 0; i < 2; i++)
          panel(
            frame,
            entryX,
            base + 3.01 + i * 3.15,
            -0.065,
            1.5,
            0.45,
            p,
            p.body,
          );
      }
    // Brick chimney and capped roof vents; no texture download required.
    const chimneyX = width * 0.31,
      chimneyY = top + 0.78,
      chimneyZ = depth * 0.6;
    box(
      frame,
      chimneyX,
      chimneyY,
      chimneyZ,
      0.68,
      1.45,
      0.85,
      '#866554',
      stone,
    );
    for (let yy = top + 0.1; yy < top + 1.5; yy += 0.12)
      box(
        frame,
        chimneyX,
        yy,
        chimneyZ - 0.431,
        0.67,
        0.014,
        0.008,
        '#a99980',
        stone,
      );
    box(
      frame,
      chimneyX,
      top + 1.54,
      chimneyZ,
      0.84,
      0.16,
      1.0,
      '#555b57',
      stone,
    );
    for (const xx of [-width * 0.23, width * 0.1]) {
      const g = new T.CylinderGeometry(0.065, 0.065, 0.66, 8);
      add(g, stone, '#6a7473', frame, matrix(xx, top + 0.42, depth * 0.4));
      g.dispose();
      box(
        frame,
        xx,
        top + 0.77,
        depth * 0.4,
        0.23,
        0.045,
        0.23,
        '#6a7473',
        stone,
      );
    }
    // Foundation patina. Separate strips leave all doors and windows clear.
    for (const side of [-1, 1])
      box(
        frame,
        side * (width / 2 - 0.1),
        0.22,
        -0.04,
        0.18,
        0.72,
        0.045,
        color(p.dark, 0.88),
        stone,
      );
    add(
      new T.PlaneGeometry(width, 0.35).rotateY(Math.PI),
      grime,
      null,
      frame,
      matrix(0, 0.03, -0.062),
    );
  });

  {
    const x = 18.3,
      frame = matrix(
        x,
        roadHeight(x) + 0.12,
        -(roadY(x) - 11.9),
        1,
        1,
        1,
        angle,
      );
    for (const xx of [-1.25, 1.25]) {
      box(frame, xx, 0.76, 0, 0.18, 1.52, 0.22, '#596c62');
      box(frame, xx, 1.55, 0, 0.25, 0.085, 0.28, '#d4cbb2');
    }
    for (const yy of [0.19, 1.26])
      box(frame, 0, yy, 0, 2.4, 0.045, 0.05, '#3d4f48');
    for (let xx = -1.12; xx < 1.2; xx += 0.14) {
      box(frame, xx, 0.74, 0, 0.025, 1.25, 0.025, '#3d4f48');
      const tip = new T.ConeGeometry(0.04, 0.14, 4);
      add(tip, paint, '#887f56', frame, matrix(xx, 1.42, 0));
      tip.dispose();
    }
  }

  // Two cast-iron standards: restrained silhouettes, away from the hero car.
  for (const x of [-17, 43]) {
    const frame = matrix(x, roadHeight(x) + 0.12, -(roadY(x) - 6.15));
    const shade = '#354744';
    const pole = new T.CylinderGeometry(0.047, 0.082, 4.5, 10);
    add(pole, paint, shade, frame, matrix(0, 2.25, 0));
    pole.dispose();
    for (const [y, r, h] of [
      [0.14, 0.17, 0.28],
      [0.38, 0.12, 0.17],
      [4.35, 0.1, 0.1],
    ]) {
      const g = new T.CylinderGeometry(r, r, h, 10);
      add(g, paint, shade, frame, matrix(0, y, 0));
      g.dispose();
    }
    box(frame, 0, 4.6, 0, 0.29, 0.43, 0.29, '#bcb8a0', stone);
    for (const xx of [-0.15, 0.15])
      for (const zz of [-0.15, 0.15])
        box(frame, xx, 4.6, zz, 0.025, 0.46, 0.025, shade);
    const cap = new T.ConeGeometry(0.29, 0.25, 4);
    cap.rotateY(Math.PI / 4);
    add(cap, paint, shade, frame, matrix(0, 4.94, 0));
    cap.dispose();
  }

  // Compact ornamental street trees in real pavement openings. The leaf
  // cluster atlas is original canvas artwork, not a downloaded photograph.
  const leavesMap = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 88; i++) {
      const a = hash(i, 42) * Math.PI * 2,
        r = Math.sqrt(hash(i, 43)) * 0.45;
      const x = w * (0.5 + Math.cos(a) * r),
        y = h * (0.5 + Math.sin(a) * r);
      ctx.strokeStyle = '#484832';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.85);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = ['#38573a', '#537246', '#6b8050', '#849361'][i % 4];
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        3 + hash(i, 44) * 2,
        1.6 + hash(i, 45) * 1.4,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
  const leavesMat = new T.MeshStandardMaterial({
    map: leavesMap,
    alphaTest: 0.45,
    side: T.DoubleSide,
    roughness: 0.91,
  });
  leavesMat.name = 'Street tree leaves';
  const leafParts = [];
  for (const [ti, x] of houseTreeXs.entries()) {
    const frame = matrix(x, roadHeight(x) + 0.12, -(roadY(x) - 6.55));
    box(frame, 0, -0.025, 0, 1.28, 0.065, 1.48, '#655c44', stone);
    for (const side of [-1, 1]) {
      box(frame, side * 0.675, 0.015, 0, 0.07, 0.04, 1.58, '#9e9c89', stone);
      box(frame, 0, 0.015, side * 0.775, 1.42, 0.04, 0.07, '#9e9c89', stone);
    }
    const stem = (a, b, r0, r1) => {
      const av = new T.Vector3(...a),
        bv = new T.Vector3(...b),
        dir = bv.clone().sub(av);
      const g = new T.CylinderGeometry(r1, r0, dir.length(), 7);
      const m = new T.Matrix4().compose(
        av.clone().add(bv).multiplyScalar(0.5),
        new T.Quaternion().setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          dir.normalize(),
        ),
        new T.Vector3(1, 1, 1),
      );
      add(g, stone, '#716a55', frame, m);
      g.dispose();
    };
    stem([0, 0, 0], [0.08, 2.7, 0.06], 0.11, 0.055);
    for (let k = 0; k < 7; k++) {
      const a = k * 2.399 + ti,
        dx = Math.cos(a) * 0.8,
        dz = Math.sin(a) * 0.8,
        yy = 3.05 + hash(k, ti) * 1.0;
      stem([0.04, 1.8 + k * 0.09, 0], [dx, yy, dz], 0.04, 0.009);
      for (let i = 0; i < 72; i++) {
        const theta = hash(i + k * 100, 52) * 6.28,
          rr = Math.cbrt(hash(i + k * 100, 53)) * 0.84;
        const ly = (hash(i + k * 100, 54) - 0.5) * 1.05;
        const g = new T.PlaneGeometry(0.45, 0.48);
        g.rotateX(hash(i, 56) * Math.PI);
        g.rotateY(hash(i, 57) * 6.28);
        g.rotateZ(hash(i, 58) * 6.28);
        g.translate(
          dx + Math.cos(theta) * rr,
          yy + ly,
          dz + Math.sin(theta) * rr * 0.7,
        );
        g.applyMatrix4(frame);
        leafParts.push(g);
      }
    }
  }
  const treeMesh = new T.Mesh(mergeGeometries(leafParts), leavesMat);
  treeMesh.name = 'Merged street tree crowns';
  treeMesh.castShadow = treeMesh.receiveShadow = true;
  row.add(treeMesh);
  leafParts.forEach((g) => g.dispose());

  for (const [mat, geos] of parts) {
    const merged = mergeGeometries(geos);
    const mesh = new T.Mesh(merged, mat);
    mesh.name = mat.name || 'Merged house surfaces';
    mesh.castShadow = mat !== grime;
    mesh.receiveShadow = true;
    row.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  for (const { kind, shade, matrices } of repeated.values()) {
    const geometry = (
      kind === 'bracket'
        ? bracketGeo
        : kind === 'baluster'
          ? balusterGeo
          : kind === 'column'
            ? columnGeo
            : unit
    ).clone();
    // Colour lives on the shared geometry, so GLTF export does not depend on
    // the renderer-only instanceColor attribute. Each set is one draw call.
    const c = new T.Color(shade),
      values = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < values.length; i += 3) {
      values[i] = c.r;
      values[i + 1] = c.g;
      values[i + 2] = c.b;
    }
    geometry.setAttribute('color', new T.BufferAttribute(values, 3));
    const mesh = new T.InstancedMesh(geometry, paint, matrices.length);
    mesh.name = `Instanced ${kind} / ${shade}`;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = mesh.receiveShadow = true;
    row.add(mesh);
  }
  unit.dispose();
  board.dispose();
  bracketGeo.dispose();
  balusterGeo.dispose();
  columnGeo.dispose();
  const stats = {
    houses: report.length,
    triangles: 0,
    drawCalls: 0,
    instances: 0,
    textureBytes: 0,
    textureMaps: 4,
    lots: report,
  };
  row.traverse((o) => {
    if (!o.isMesh) return;
    const count = o.isInstancedMesh ? o.count : 1;
    stats.triangles +=
      ((o.geometry.index?.count || o.geometry.attributes.position.count) / 3) *
      count;
    stats.drawCalls++;
    if (o.isInstancedMesh) stats.instances += o.count;
  });
  // RGBA8 textures plus full mip chains; cubemap is shared with scene glass.
  stats.textureBytes = Math.ceil(
    ((256 * 256 + 64 * 128 + 1024 * 32 + 128 * 128) * 4 * 4) / 3,
  );
  row.userData.stats = stats;
  scene.add(row);
  return { row, stats };
}
