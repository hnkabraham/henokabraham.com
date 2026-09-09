import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import { sampleElevation, type ElevationGrid } from './bay-city';
import {
  GOLDEN_GATE,
  addGroundShade,
  mercatorToLocal,
  type BaySurfaceControls,
  type SurfaceLayer,
} from './bay-surface';

/**
 * The Golden Gate Bridge, built from its published dimensions in the deck
 * frame fitted from OpenStreetMap (`GOLDEN_GATE`): two 227 m towers with
 * their portal struts, the 1,280 m main span and 343 m side spans, the
 * main cables and their hanger ropes, the 29 m stiffened deck, the
 * anchorage pylons and blocks, the approach viaducts to the toll plaza and
 * Vista Point, and the south tower's fender pier. Metres above mean water.
 */
const TOWER_TOP = 227;
const DECK_TOP = 73;
const CAMBER = 4;
const TRUSS = 7.6;
const HALF_WIDTH = 14.5;
const LEG_ACROSS = 19;
const CABLE_ACROSS = 15.5;
const PYLON_TOP = 103;
const ANCHORAGE_TOP = 42;
const HANGER_SPACING = 15.24;
export const INTERNATIONAL_ORANGE = 0xc0362c;

/**
 * Deck centreline as (metres along the axis, metres east of it), averaged
 * from both OpenStreetMap carriageways: straight between the anchorages,
 * curving east to the toll plaza and west into the Marin headland.
 */
const CENTRELINE: [number, number][] = [
  [-1420, 125], [-1390, 102], [-1360, 80], [-1330, 59], [-1306, 43.5],
  [-1280, 29.5], [-1254, 18.5], [-1226, 9.5], [-1190, 3], [-1154, 0],
  [1150, 0], [1185, -0.5], [1215, -1.5], [1245, -5.5], [1275, -12.5],
  [1305, -21.5], [1335, -34.5], [1360, -50], [1385, -63], [1410, -77],
];
/** Where the approaches leave deck level and settle onto the ground. */
const SOUTH_RAMP = [-1330, -1420] as const;
const NORTH_RAMP = [1300, 1410] as const;

type Frame = {
  origin: readonly [number, number];
  axis: readonly [number, number];
  perp: readonly [number, number];
};

/** The deck frame in local scene metres: origin, north-pointing axis, east-pointing perpendicular. */
export function goldenGateFrame(): Frame {
  const { centre, axis } = GOLDEN_GATE;
  const [ox, oz] = mercatorToLocal(centre[0], centre[1]);
  const [nx, nz] = mercatorToLocal(
    centre[0] + axis[0] * 1000,
    centre[1] + axis[1] * 1000,
  );
  const length = Math.hypot(nx - ox, nz - oz);
  const unit = [(nx - ox) / length, (nz - oz) / length] as const;
  return { origin: [ox, oz], axis: unit, perp: [-unit[1], unit[0]] };
}

const smooth = (t: number) => {
  const s = Math.min(1, Math.max(0, t));
  return s * s * (3 - 2 * s);
};

/** Flat-shaded quads and fans collected into one indexed geometry. */
class Builder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  extra: number[] = [];
  indices: number[] = [];
  private scratch = [new Vector3(), new Vector3(), new Vector3()];

  /** A quad a-b-c-d; `inside` flips the winding so the face points away from it. */
  quad(
    a: Vector3,
    b: Vector3,
    c: Vector3,
    d: Vector3,
    inside?: Vector3,
    uv?: [number, number][],
    extra?: number[],
  ) {
    const [ab, ad, n] = this.scratch;
    n.crossVectors(ab.subVectors(b, a), ad.subVectors(d, a)).normalize();
    let corners = [a, b, c, d];
    let uvs = uv ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    let extras = extra ?? [0, 0, 0, 0];
    if (inside && n.dot(ab.subVectors(a, inside)) < 0) {
      n.negate();
      corners = [a, d, c, b];
      uvs = [uvs[0], uvs[3], uvs[2], uvs[1]];
      extras = [extras[0], extras[3], extras[2], extras[1]];
    }
    const base = this.positions.length / 3;
    corners.forEach((p, i) => {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.uvs.push(uvs[i][0], uvs[i][1]);
      this.extra.push(extras[i]);
    });
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A convex polygon fanned from its first corner, facing `normal`. */
  polygon(corners: Vector3[], normal: Vector3) {
    const base = this.positions.length / 3;
    for (const p of corners) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(0, 0);
      this.extra.push(0);
    }
    for (let i = 1; i + 1 < corners.length; i++)
      this.indices.push(base, base + i, base + i + 1);
  }

  build(extraName?: string) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.positions), 3),
    );
    geometry.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(this.normals), 3),
    );
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    if (extraName)
      geometry.setAttribute(
        extraName,
        new BufferAttribute(new Float32Array(this.extra), 1),
      );
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Roadway: sidewalks with orange railings, three lanes each way, a yellow median. */
function createRoadTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const px = 256 / (HALF_WIDTH * 2);
  context.fillStyle = '#3b3d40';
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = '#9d9a92';
  context.fillRect(0, 0, 3.1 * px, 256);
  context.fillRect(256 - 3.1 * px, 0, 3.1 * px, 256);
  context.fillStyle = '#c0362c';
  context.fillRect(0, 0, 0.6 * px, 256);
  context.fillRect(256 - 0.6 * px, 0, 0.6 * px, 256);
  context.fillStyle = '#e9b83a';
  context.fillRect(128 - 0.3 * px, 0, 0.6 * px, 256);
  context.fillStyle = '#e8e6df';
  for (const lane of [1, 2, 4, 5]) {
    const x = (3.1 + lane * 3.8) * px;
    context.fillRect(x - 0.08 * px, 0, 0.16 * px, 256 * 0.2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export function createGoldenGateBridge(
  elevation: ElevationGrid,
  layers: SurfaceLayer[],
  surface: BaySurfaceControls,
) {
  const frame = goldenGateFrame();
  const [south, north] = GOLDEN_GATE.towers;
  const [southPylon, northPylon] = GOLDEN_GATE.pylons;
  const mid = (south + north) / 2;
  const halfMain = (north - south) / 2;
  const at = (along: number, across: number, y: number) =>
    new Vector3(
      frame.origin[0] + frame.axis[0] * along + frame.perp[0] * across,
      y,
      frame.origin[1] + frame.axis[1] * along + frame.perp[1] * across,
    );
  const ground = (along: number, across: number) => {
    const p = at(along, across, 0);
    return sampleElevation(elevation, p.x, p.z);
  };
  /** Roadway height: cambered over the main span, ramping to the ground at both ends. */
  const deckTop = (along: number, across = 0) => {
    const bump = 1 - ((along - mid) / halfMain) ** 2;
    let y = DECK_TOP + CAMBER * Math.max(0, bump);
    const ramp =
      along < SOUTH_RAMP[0]
        ? smooth((SOUTH_RAMP[0] - along) / (SOUTH_RAMP[0] - SOUTH_RAMP[1]))
        : along > NORTH_RAMP[0]
          ? smooth((along - NORTH_RAMP[0]) / (NORTH_RAMP[1] - NORTH_RAMP[0]))
          : 0;
    if (ramp > 0) y = y + (ground(along, across) + 1.5 - y) * ramp;
    return y;
  };
  /** Main cable height over the suspended spans, from the tower tops. */
  const sag = TOWER_TOP - (deckTop(mid) + 3);
  const sideDrop = TOWER_TOP - PYLON_TOP;
  const curvature = sag / halfMain ** 2;
  const sideSpan = north - northPylon > 0 ? northPylon - north : 343;
  const sideSlope = (sideDrop - curvature * sideSpan ** 2) / sideSpan;
  const cableTop = (along: number) => {
    if (along >= south && along <= north)
      return TOWER_TOP - sag * (1 - ((along - mid) / halfMain) ** 2);
    const u = along < south ? south - along : along - north;
    return TOWER_TOP - sideSlope * u - curvature * u * u;
  };

  const radius = 0.6;
  const steel = new Builder();
  const road = new Builder();
  const concrete = new Builder();
  const cables = new Builder();
  const hangers = new Builder();

  const box = (
    target: Builder,
    s0: number,
    s1: number,
    a0: number,
    a1: number,
    y0: number,
    y1: number,
  ) => {
    const inside = at((s0 + s1) / 2, (a0 + a1) / 2, (y0 + y1) / 2);
    const P = (s: number, a: number, y: number) => at(s, a, y);
    // Six faces, each flipped outward by the builder.
    target.quad(P(s0, a0, y1), P(s1, a0, y1), P(s1, a1, y1), P(s0, a1, y1), inside);
    target.quad(P(s0, a0, y0), P(s1, a0, y0), P(s1, a1, y0), P(s0, a1, y0), inside);
    target.quad(P(s0, a0, y0), P(s1, a0, y0), P(s1, a0, y1), P(s0, a0, y1), inside);
    target.quad(P(s0, a1, y0), P(s1, a1, y0), P(s1, a1, y1), P(s0, a1, y1), inside);
    target.quad(P(s0, a0, y0), P(s0, a1, y0), P(s0, a1, y1), P(s0, a0, y1), inside);
    target.quad(P(s1, a0, y0), P(s1, a1, y0), P(s1, a1, y1), P(s1, a0, y1), inside);
  };

  // Towers: two tapering legs in four steps, joined by portal struts.
  for (const tower of [south, north]) {
    const base = Math.min(ground(tower, -LEG_ACROSS), ground(tower, LEG_ACROSS));
    const steps: [number, number, number, number][] = [
      [base - 2, 60, 13, 8.5],
      [60, 120, 12, 7.8],
      [120, 180, 11, 7.1],
      [180, TOWER_TOP, 10, 6.4],
    ];
    for (const [y0, y1, along, across] of steps)
      for (const side of [-1, 1])
        box(
          steel,
          tower - along / 2,
          tower + along / 2,
          side * LEG_ACROSS - across / 2,
          side * LEG_ACROSS + across / 2,
          y0,
          y1,
        );
    for (const [y0, y1, along, across] of [
      [30, 36, 13, 8.5],
      [98, 104, 12.5, 8],
      [136, 142, 11.5, 7.5],
      [174, 180, 11, 7.1],
      [212, 218, 10, 6.4],
    ])
      box(
        steel,
        tower - along / 2,
        tower + along / 2,
        -LEG_ACROSS + across / 2,
        LEG_ACROSS - across / 2,
        y0,
        y1,
      );
  }
  // The south tower stands in the strait on an elliptical fender pier; the
  // north tower on a plinth at Lime Point.
  {
    const ring: Vector3[] = [];
    const top: Vector3[] = [];
    const segments = 28;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push(at(south + Math.cos(angle) * 23, Math.sin(angle) * 45, -2));
      top.push(at(south + Math.cos(angle) * 23, Math.sin(angle) * 45, 5));
    }
    const centre = at(south, 0, 0);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      concrete.quad(ring[i], ring[j], top[j], top[i], centre);
    }
    concrete.polygon(top, new Vector3(0, 1, 0));
    box(concrete, north - 22, north + 22, -32, 32, ground(north, 0) - 3, 3);
  }
  // Anchorage pylons and blocks at both ends of the suspended structure.
  for (const [pylon, outward] of [
    [southPylon, -1],
    [northPylon, 1],
  ]) {
    const base = ground(pylon, 0);
    box(
      concrete,
      Math.min(pylon - 6, pylon + outward * 52),
      Math.max(pylon - 6, pylon + outward * 52),
      -21,
      21,
      base - 3,
      ANCHORAGE_TOP,
    );
    for (const side of [-1, 1])
      box(
        steel,
        pylon - 4.5,
        pylon + 4.5,
        side * LEG_ACROSS - 5,
        side * LEG_ACROSS + 5,
        ANCHORAGE_TOP - 1,
        PYLON_TOP,
      );
    box(steel, pylon - 4.5, pylon + 4.5, -LEG_ACROSS + 5, LEG_ACROSS - 5, PYLON_TOP - 6, PYLON_TOP);
  }

  // Deck: the roadway on top, the stiffening truss's sides and bottom in
  // steel, following the centreline through the curved approaches.
  {
    const stations: { along: number; across: number }[] = [];
    for (let i = 0; i + 1 < CENTRELINE.length; i++) {
      const [s0, a0] = CENTRELINE[i];
      const [s1, a1] = CENTRELINE[i + 1];
      const count = Math.max(1, Math.round((s1 - s0) / 25));
      for (let k = 0; k < count; k++) {
        const t = k / count;
        stations.push({ along: s0 + (s1 - s0) * t, across: a0 + (a1 - a0) * t });
      }
    }
    stations.push({
      along: CENTRELINE[CENTRELINE.length - 1][0],
      across: CENTRELINE[CENTRELINE.length - 1][1],
    });
    const corners = stations.map((station, i) => {
      const previous = stations[Math.max(0, i - 1)];
      const next = stations[Math.min(stations.length - 1, i + 1)];
      const direction = at(next.along, next.across, 0).sub(
        at(previous.along, previous.across, 0),
      );
      const right = new Vector3(-direction.z, 0, direction.x).normalize();
      const y = deckTop(station.along, station.across);
      const centre = at(station.along, station.across, y);
      return {
        y,
        centre,
        topLeft: centre.clone().addScaledVector(right, -HALF_WIDTH),
        topRight: centre.clone().addScaledVector(right, HALF_WIDTH),
        bottomLeft: centre.clone().addScaledVector(right, -(HALF_WIDTH - 1)).setY(y - TRUSS),
        bottomRight: centre.clone().addScaledVector(right, HALF_WIDTH - 1).setY(y - TRUSS),
      };
    });
    for (let i = 0; i + 1 < corners.length; i++) {
      const a = corners[i],
        b = corners[i + 1];
      const v0 = stations[i].along / HANGER_SPACING,
        v1 = stations[i + 1].along / HANGER_SPACING;
      const inside = a.centre.clone().add(b.centre).multiplyScalar(0.5).setY((a.y + b.y) / 2 - TRUSS / 2);
      road.quad(a.topLeft, b.topLeft, b.topRight, a.topRight, inside, [
        [0, v0],
        [0, v1],
        [1, v1],
        [1, v0],
      ]);
      steel.quad(a.topLeft, b.topLeft, b.bottomLeft, a.bottomLeft, inside);
      steel.quad(a.topRight, b.topRight, b.bottomRight, a.bottomRight, inside);
      steel.quad(a.bottomLeft, b.bottomLeft, b.bottomRight, a.bottomRight, inside);
    }
    // Approach viaduct bents wherever the deck is clear of the ground.
    for (let i = 0; i < stations.length; i += 2) {
      const { along, across } = stations[i];
      if (along > southPylon - 20 && along < northPylon + 20) continue;
      const y = corners[i].y - TRUSS;
      const floor = ground(along, across);
      if (y - floor < 4) continue;
      const right = corners[i].topRight.clone().sub(corners[i].topLeft).normalize();
      for (const side of [-1, 1]) {
        const c = corners[i].centre.clone().addScaledVector(right, side * 10);
        const s = frame.axis[0] * (c.x - frame.origin[0]) + frame.axis[1] * (c.z - frame.origin[1]);
        const a = frame.perp[0] * (c.x - frame.origin[0]) + frame.perp[1] * (c.z - frame.origin[1]);
        box(steel, s - 1.1, s + 1.1, a - 1.1, a + 1.1, floor - 2, y + 0.5);
      }
    }
  }

  // Main cables from anchorage to anchorage over the tower tops, as thin
  // tubes, with the hanger ropes as translucent curtains down to the deck.
  for (const side of [-1, 1]) {
    const across = side * CABLE_ACROSS;
    const points: Vector3[] = [];
    const start = southPylon - 45,
      end = northPylon + 45;
    for (let along = start; along <= end + 0.01; along += HANGER_SPACING / 2) {
      const s = Math.min(along, end);
      let y = cableTop(s);
      // Dive into the anchorage block beyond each pylon.
      if (s < southPylon) y = PYLON_TOP + (ANCHORAGE_TOP - PYLON_TOP) * smooth((southPylon - s) / 45);
      if (s > northPylon) y = PYLON_TOP + (ANCHORAGE_TOP - PYLON_TOP) * smooth((s - northPylon) / 45);
      points.push(at(s, across, y));
    }
    const ringOf = (p: Vector3, tangent: Vector3) => {
      const up = Math.abs(tangent.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      const u = new Vector3().crossVectors(tangent, up).normalize();
      const v = new Vector3().crossVectors(u, tangent).normalize();
      return [0, 1, 2, 3, 4, 5].map((k) => {
        const angle = (k / 6) * Math.PI * 2;
        return p.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
      });
    };
    let previous: Vector3[] | null = null;
    for (let i = 0; i < points.length; i++) {
      const tangent = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const ring = ringOf(points[i], tangent);
      if (previous)
        for (let k = 0; k < 6; k++) {
          const j = (k + 1) % 6;
          cables.quad(previous[k], previous[j], ring[j], ring[k], points[i].clone().add(points[i - 1]).multiplyScalar(0.5));
        }
      previous = ring;
    }
    // Hanger curtain between the cable and the deck edge.
    const edge = side * (HALF_WIDTH - 0.6);
    let last: { top: Vector3; bottom: Vector3; along: number } | null = null;
    for (let along = southPylon; along <= northPylon + 0.01; along += HANGER_SPACING) {
      const s = Math.min(along, northPylon);
      const top = at(s, across, cableTop(s));
      const bottom = at(s, edge, deckTop(s) + 0.6);
      const current = { top, bottom, along: s };
      if (last && top.y > bottom.y + 2 && last.top.y > last.bottom.y + 2)
        hangers.quad(last.bottom, current.bottom, current.top, last.top, undefined, undefined, [
          last.along, s, s, last.along,
        ]);
      last = current;
    }
  }

  const geometries = {
    steel: steel.build(),
    road: road.build(),
    concrete: concrete.build(),
    cables: cables.build(),
    hangers: hangers.build('along'),
  };
  const roadTexture = createRoadTexture();
  const steelMaterial = new MeshStandardMaterial({
    color: INTERNATIONAL_ORANGE,
    roughness: 0.72,
    metalness: 0.05,
  });
  const roadMaterial = new MeshStandardMaterial({
    color: roadTexture ? 0xffffff : 0x4a4c4f,
    map: roadTexture,
    roughness: 0.92,
  });
  const concreteMaterial = new MeshStandardMaterial({
    color: 0x9a9791,
    roughness: 0.9,
  });
  const cableMaterial = new MeshStandardMaterial({
    color: INTERNATIONAL_ORANGE,
    roughness: 0.6,
    metalness: 0.1,
  });
  const hangerMaterial = new MeshStandardMaterial({
    color: INTERNATIONAL_ORANGE,
    roughness: 0.8,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  for (const material of [steelMaterial, roadMaterial, concreteMaterial])
    addGroundShade(material, layers, surface);
  // A 0.92 m cable is thinner than a pixel from the flight; inflate it so
  // it never drops below about a pixel and a half on screen.
  addGroundShade(cableMaterial, layers, surface, undefined, {
    key: 'bridge-cable-v1',
    glsl: `transformed += normal * max(0.0, length((modelViewMatrix * vec4(position, 1.0)).xyz) * 0.00045 - ${radius.toFixed(2)});`,
  });
  // Hanger ropes every 15.24 m, antialiased by their pixel footprint, over
  // a faint veil so the curtain still reads from kilometres away.
  hangerMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float along;\nvarying float vAlong;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = along;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float spacing = ${HANGER_SPACING.toFixed(2)};
          float d = abs(fract(vAlong / spacing) - 0.5) * spacing;
          float aa = fwidth(vAlong) + 1e-3;
          float rope = (1.0 - smoothstep(0.16, 0.16 + aa, d)) * min(1.0, 0.32 / aa);
          diffuseColor.a = clamp(rope + 0.07, 0.0, 0.9);
        }`,
      );
  };
  hangerMaterial.customProgramCacheKey = () => 'bridge-hangers-v1';

  const group = new Group();
  const materials: Material[] = [];
  for (const [name, material] of [
    ['steel', steelMaterial],
    ['road', roadMaterial],
    ['concrete', concreteMaterial],
    ['cables', cableMaterial],
    ['hangers', hangerMaterial],
  ] as const) {
    const mesh = new Mesh(geometries[name], material);
    mesh.name = `golden-gate-${name}`;
    materials.push(material);
    group.add(mesh);
  }
  return {
    group,
    materials,
    geometries: Object.values(geometries),
    texture: roadTexture,
    frame,
    deckTop,
    cableTop,
  };
}
