import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  ExtrudeGeometry,
} from 'three';
import { BAY_ORIGIN } from './bay-flight';

type Ring = [number, number][];
export type AirportBuildings = {
  features: {
    geometry: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: Ring[] | Ring[][];
    };
    properties: {
      building?: string;
      'building:part'?: string;
      aeroway?: string;
      height_m?: number;
      min_height_m?: number;
      levels?: number;
      min_level?: number;
    };
  }[];
};

export function lonLatToBay(lon: number, lat: number) {
  const mx = (6378137 * lon * Math.PI) / 180;
  const my = 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const px =
    0.07915772966115583 * mx - 0.0004519390553973489 * my + 1085905.55448784;
  const py =
    -0.0004973835512757917 * mx - 0.0788309597692652 * my + 358610.37375675904;
  return [(px - BAY_ORIGIN[0]) * 10, (py - BAY_ORIGIN[1]) * 10] as const;
}
/** Darker glazing bands per floor, so massing reads as buildings from the air. */
function addWallBanding(material: MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWallPoint;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWallPoint = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWallPoint;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float floorPhase = fract(vWallPoint.y / 3.6);
      float glazing = smoothstep(0.30, 0.38, floorPhase) * (1.0 - smoothstep(0.72, 0.80, floorPhase));
      // Mullions along the facade, spaced with the building's tint so blocks differ.
      float mullion = step(0.9, fract((vWallPoint.x + vWallPoint.z) * (0.55 + vColor.r * 0.2)));
      diffuseColor.rgb *= mix(1.0, 0.55 + 0.2 * mullion, glazing * 0.85);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.25, glazing * 0.7);`,
      );
  };
  material.customProgramCacheKey = () => 'sfo-wall-banding-v1';
}

export function createAirportBuildings(
  data: AirportBuildings,
  elevation: Uint16Array,
) {
  const group = new Group();
  const positions: number[][] = [[], []],
    normals: number[][] = [[], []],
    tints: number[][] = [[], []];
  // The elevation grid is square and covers source pixels 3500–8300 / 5200–10000.
  const grid = Math.round(Math.sqrt(elevation.length));
  const last = grid - 1;
  const baseHeight = (x: number, z: number) => {
    const col = Math.max(
      0,
      Math.min(last, Math.round(((x / 10 + BAY_ORIGIN[0] - 3500) / 4800) * last)),
    );
    const row = Math.max(
      0,
      Math.min(last, Math.round(((z / 10 + BAY_ORIGIN[1] - 5200) / 4800) * last)),
    );
    return elevation[row * grid + col] / 4;
  };
  let index = 0;
  for (const feature of data.features) {
    const props = feature.properties;
    // Deterministic per-building tone: real roofs and cladding are not one grey.
    const hash = (Math.sin(++index * 12.9898) * 43758.5453) % 1;
    const tint = 0.82 + 0.36 * Math.abs(hash);
    // Retain the tower's upper cabin; avoid stacking other parts on full parent masses.
    if (props['building:part'] && props.aeroway !== 'tower') continue;
    const height =
      props.height_m ??
      (props.levels
        ? props.levels * 3.2
        : props.building === 'hangar'
          ? 15
          : 8);
    const minHeight = props.min_height_m ?? (props.min_level ?? 0) * 3.2;
    if (height <= minHeight) continue;
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as Ring[]]
        : (feature.geometry.coordinates as Ring[][]);
    for (const polygon of polygons) {
      const coordinates = polygon.map((r) =>
        r.map(([lon, lat]) => lonLatToBay(lon, lat)),
      );
      const shape = new Shape();
      coordinates.forEach((ring, index) => {
        const path = index === 0 ? shape : new Path();
        ring.forEach(([x, z], i) => {
          if (i === 0) path.moveTo(x, -z);
          else path.lineTo(x, -z);
        });
        if (index > 0) shape.holes.push(path);
      });
      const first = coordinates[0][0];
      const geometry = new ExtrudeGeometry(shape, {
        depth: height - minHeight,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, baseHeight(first[0], first[1]) + minHeight, 0);
      const p = geometry.attributes.position,
        n = geometry.attributes.normal;
      // Combine roof triangles and wall triangles separately: two draw calls for the airport.
      for (const part of geometry.groups) {
        const bucket = part.materialIndex === 0 ? 0 : 1;
        for (let i = part.start; i < part.start + part.count; i++) {
          positions[bucket].push(p.getX(i), p.getY(i), p.getZ(i));
          normals[bucket].push(n.getX(i), n.getY(i), n.getZ(i));
          tints[bucket].push(tint, tint, tint);
        }
      }
      geometry.dispose();
    }
  }
  for (let i = 0; i < 2; i++) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(positions[i], 3),
    );
    geometry.setAttribute('normal', new Float32BufferAttribute(normals[i], 3));
    geometry.setAttribute('color', new Float32BufferAttribute(tints[i], 3));
    geometry.computeBoundingSphere();
    const material = new MeshStandardMaterial({
      color: i === 0 ? 0xb5b8b6 : 0x8a979c,
      roughness: i === 0 ? 0.82 : 0.6,
      metalness: i === 0 ? 0.08 : 0.25,
      vertexColors: true,
    });
    if (i === 1) addWallBanding(material);
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
