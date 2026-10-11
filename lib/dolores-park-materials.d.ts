import type { Material, Object3D, Texture, Vector3 } from 'three';
export interface DoloresMaterialOptions {
  toSun?: Vector3;
  detail?: Texture;
}
export function applyDoloresMaterial(
  material: Material,
  kind?: string,
  options?: DoloresMaterialOptions,
): boolean;
export function restoreDoloresMaterials(
  root: Object3D,
  options?: DoloresMaterialOptions,
): number;
