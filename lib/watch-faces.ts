// The Bezel Auth faces that run on the site, each with its font slots. A face
// draws one frame into a canvas context already scaled to the watch's
// 416-pixel square.
import * as atelier from './watch-face-atelier';
import * as chrono from './watch-face-chrono';
import { BLACK, Dc, type Frame, type SlotMetrics } from './watch-face-dc';
import * as orbit from './watch-face-orbit';
import * as summit from './watch-face-summit';
import * as tactical from './watch-face-tactical';
import * as words from './watch-face-words';

export type FaceId =
  'summit' | 'atelier' | 'tactical' | 'chrono' | 'orbit' | 'words';

export type FaceArt = { mountain: CanvasImageSource | null };

type Draw = (dc: Dc, frame: Frame, mountain?: CanvasImageSource | null) => void;
type Face = { fonts: SlotMetrics[]; drawActive: Draw; drawAlwaysOn: Draw };

// Slot order: Clock, Code, Label, Small, Stat, Aod, AodDate.
const faces: Record<FaceId, Face> = {
  atelier: {
    ...atelier,
    fonts: [
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [0, 20, 16, 7], l: [0, 20] },
      { n: [0, 14, 11, 5], l: [0, 14] },
      { n: [0, 12, 10, 4], l: [0, 12] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [0, 13, 11, 5], l: [0, 13] },
    ],
  },
  chrono: {
    ...chrono,
    fonts: [
      { n: [0, 18, 15, 6], l: [0, 18] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [0, 13, 11, 5], l: [0, 13] },
      { n: [0, 10, 8, 4], l: [0, 10] },
      { n: [0, 16, 13, 5], l: [0, 16] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [0, 12, 10, 4], l: [0, 12] },
    ],
  },
  summit: {
    ...summit,
    fonts: [
      { n: [5, 71, 57, 23], l: [-1, 83] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [1, 12, 9, 4], l: [0, 14] },
      { n: [1, 10, 8, 4], l: [0, 12] },
      { n: [1, 17, 13, 6], l: [0, 20] },
      { n: [-1, 64, 52, 21], l: [-1, 64] },
      { n: [0, 13, 11, 5], l: [0, 13] },
    ],
  },
  tactical: {
    ...tactical,
    fonts: [
      { n: [-1, 70, 56, 23], l: [-1, 70] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [0, 13, 11, 5], l: [0, 13] },
      { n: [0, 10, 8, 4], l: [0, 10] },
      { n: [2, 15, 12, 5], l: [0, 19] },
      { n: [-1, 56, 45, 18], l: [-1, 56] },
      { n: [0, 11, 9, 4], l: [0, 11] },
    ],
  },
  words: {
    ...words,
    fonts: [
      // Words sets its clock in words, so that slot has no numerals.
      { n: null, l: [3, 40] },
      { n: [0, 17, 14, 6], l: [0, 17] },
      { n: [1, 12, 9, 4], l: [0, 14] },
      { n: [0, 12, 10, 4], l: [0, 12] },
      { n: [2, 18, 14, 6], l: [0, 22] },
      { n: [-1, 76, 61, 24], l: [-1, 76] },
      { n: [0, 14, 11, 5], l: [0, 14] },
    ],
  },
  orbit: {
    ...orbit,
    fonts: [
      { n: [0, 47, 38, 15], l: [0, 47] },
      { n: [0, 15, 12, 5], l: [0, 15] },
      { n: [0, 13, 11, 5], l: [0, 13] },
      { n: [0, 10, 8, 4], l: [0, 10] },
      { n: [0, 16, 13, 5], l: [0, 16] },
      { n: [-1, 41, 33, 13], l: [-1, 41] },
      { n: [0, 12, 10, 4], l: [0, 12] },
    ],
  },
};

export function drawFace(
  ctx: CanvasRenderingContext2D,
  id: FaceId,
  frame: Frame,
  alwaysOn: boolean,
  art: FaceArt = { mountain: null },
) {
  const face = faces[id];
  const dc = new Dc(ctx, face.fonts);
  // Always-on starts from black, as DuoFaceView.onUpdate clears before
  // handing over; the awake views clear for themselves.
  dc.setColor(BLACK, BLACK);
  dc.clear();
  if (alwaysOn) face.drawAlwaysOn(dc, { ...frame, code: null }, art.mountain);
  else face.drawActive(dc, frame, art.mountain);
}
