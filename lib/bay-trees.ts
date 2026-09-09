import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { sampleElevation, type ElevationGrid } from './bay-city';
import {
  addGroundShade,
  type BaySurfaceControls,
  type SurfaceLayer,
} from './bay-surface';

/** Tree canopies packed by scripts/prepare-bay-trees.py. */
export type TreeCanopies = {
  count: number;
  /** Per tree: int16 x, int16 z (local metres), u8 diameter (0.1 m), rgb. */
  records: DataView;
};

const RECORD = 8;

export async function loadTreeCanopies(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Trees unavailable');
  let buffer = await response.arrayBuffer();
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('Trees need DecompressionStream');
    buffer = await new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
  }
  const count = new DataView(buffer).getUint32(0, true);
  if (buffer.byteLength < 4 + count * RECORD)
    throw new Error('Truncated tree file');
  return { count, records: new DataView(buffer, 4, count * RECORD) };
}

/**
 * One instanced draw call of low-poly canopies standing on the terrain,
 * coloured from the photograph beneath each tree and lit under the same
 * baked shadows and cloud cover as the ground.
 */
export async function createTreeMesh(
  trees: TreeCanopies,
  elevation: ElevationGrid,
  layers: SurfaceLayer[],
  surface: BaySurfaceControls,
  yieldNow?: () => Promise<void>,
) {
  const geometry = new OctahedronGeometry(0.5, 0);
  const grow = { value: 0 };
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.93,
    metalness: 0,
    flatShading: true,
  });
  addGroundShade(material, layers, surface, grow);
  const mesh = new InstancedMesh(geometry, material, trees.count);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const color = new Color();
  let sliceStart = performance.now();
  for (let i = 0; i < trees.count; i++) {
    const at = i * RECORD;
    const x = trees.records.getInt16(at, true);
    const z = trees.records.getInt16(at + 2, true);
    const diameter = trees.records.getUint8(at + 4) / 10;
    // A deterministic twist per tree breaks the octahedron's repetition.
    const twist = ((x * 7 + z * 13) % 360) * (Math.PI / 180);
    position.set(x, sampleElevation(elevation, x, z) + diameter * 0.42, z);
    rotation.setFromAxisAngle(up, twist);
    scale.set(diameter, diameter * 0.95, diameter);
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    color.setRGB(
      trees.records.getUint8(at + 5) / 255,
      trees.records.getUint8(at + 6) / 255,
      trees.records.getUint8(at + 7) / 255,
      SRGBColorSpace,
    );
    mesh.setColorAt(i, color);
    if (yieldNow && performance.now() - sliceStart > 6) {
      await yieldNow();
      sliceStart = performance.now();
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, material, geometry, grow };
}
