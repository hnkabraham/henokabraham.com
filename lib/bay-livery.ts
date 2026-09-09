import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * The site's own livery, drawn once into a canvas: a navy fin with the
 * monogram, the registration on the rear fuselage and the wordmark forward.
 * Regions (v from the bottom): 0.625–1 port fin, 0.25–0.625 starboard fin,
 * 0.125–0.25 registration, 0–0.125 wordmark.
 */
export function createLiveryTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const navy = '#162d3d';
  const orange = '#db4f24';
  const family =
    '"Geist", "Geist Sans", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';

  // Two fin panels (2048 × 768 each, port then starboard): a navy field that
  // stops short of the leading edge, an orange stripe along the trailing
  // edge, and the monogram reading correctly from either side. The panels
  // are drawn 1.5× wider than the fin so they land at the right proportion.
  const fin = (top: number, mirrored: boolean) => {
    // The field and stripe are the same on both sides (the stripe stays on
    // the trailing edge); only the lettering is mirrored for the starboard
    // side so it reads correctly from there.
    context.fillStyle = navy;
    context.beginPath();
    context.moveTo(0, top + 40);
    context.lineTo(1880, top + 40);
    context.lineTo(2048, top + 768);
    context.lineTo(0, top + 768);
    context.closePath();
    context.fill();
    context.fillStyle = orange;
    context.beginPath();
    context.moveTo(1560, top + 40);
    context.lineTo(1880, top + 40);
    context.lineTo(2048, top + 768);
    context.lineTo(1780, top + 768);
    context.closePath();
    context.fill();
    context.fillStyle = '#ffffff';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    // The fin sweeps back, so the lettering sits toward the trailing edge.
    context.save();
    context.translate(1240, top + 380);
    context.scale(mirrored ? -1.5 : 1.5, 1);
    context.font = `700 330px ${family}`;
    context.fillText('HA', 0, 0);
    context.restore();
    context.save();
    context.translate(1240, top + 610);
    context.scale(mirrored ? -1.5 : 1.5, 1);
    context.font = `500 56px ${family}`;
    context.fillText('PERSONAL AIRSPACE', 0, 0);
    context.restore();
  };
  fin(0, false);
  fin(768, true);

  // Registration (2048 × 256, third band) and wordmark (bottom band).
  context.fillStyle = navy;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.font = `700 210px ${family}`;
  context.fillText('N787HA', 1024, 1664);
  context.font = `600 190px ${family}`;
  context.fillText('PERSONAL  AIRSPACE', 1024, 1920);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
