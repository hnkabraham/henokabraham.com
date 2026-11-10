let known: boolean | undefined;
/**
 * Whether this browser will hand out a WebGL 2 context (what Three.js
 * needs), asked once and remembered. The probe's context is given straight
 * back, so it doesn't count against the handful a phone allows a page.
 */
export function webglAvailable() {
  if (known !== undefined) return known;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    known = Boolean(gl);
  } catch {
    known = false;
  }
  return known;
}
