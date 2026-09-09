import { Ellipsoid, Geodetic } from '@takram/three-geospatial';
import { Matrix4, MathUtils, Vector3 } from 'three';

// The runway threshold is the same origin used by the registered scenery.
const sfo = new Geodetic(
  MathUtils.degToRad(-122.35805769444444),
  MathUtils.degToRad(37.61391813888889),
  0,
).toECEF();
const east = new Vector3();
const north = new Vector3();
const up = new Vector3();
Ellipsoid.WGS84.getEastNorthUpVectors(sfo, east, north, up);

// X east, Y up, Z south: a right-handed local frame, in meters. The flight
// remains near (0,0,0) on the GPU; only the atmospheric reference moves.
export const BAY_TO_ECEF = new Matrix4()
  .makeBasis(east, up, north.negate())
  .setPosition(sfo);

export function updateAtmosphereOrigin(
  matrix: Matrix4,
  localPosition: Vector3,
  scratch: Vector3,
) {
  scratch.copy(localPosition).applyMatrix4(BAY_TO_ECEF);
  matrix.copy(BAY_TO_ECEF).setPosition(scratch);
}
