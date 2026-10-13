// The watch faces that run on the site, each with its font slots. A face
// draws one frame into a canvas context already scaled to the watch's
// 416-pixel square.
import * as arcfield from './watch-face-arcfield';
import { BLACK, Dc, type Frame, type SlotMetrics } from './watch-face-dc';
import * as meridian from './watch-face-meridian';
import * as nightwatch from './watch-face-nightwatch';

export type FaceId = 'nightwatch' | 'arcfield' | 'meridian';

type Draw = (dc: Dc, frame: Frame) => void;
type Face = { fonts: SlotMetrics[]; drawActive: Draw; drawAlwaysOn: Draw };

const faces: Record<FaceId, Face> = { nightwatch, arcfield, meridian };

export function drawFace(
  ctx: CanvasRenderingContext2D,
  id: FaceId,
  frame: Frame,
  alwaysOn: boolean,
) {
  const face = faces[id];
  const dc = new Dc(ctx, face.fonts);
  // Every frame starts from black, as the watch clears before handing over.
  dc.setColor(BLACK, BLACK);
  dc.clear();
  if (alwaysOn) face.drawAlwaysOn(dc, frame);
  else face.drawActive(dc, frame);
}
