// Atelier, from AtelierView.mc: an ivory analog dial with a rust seconds hand.
import {
  AOD_DATE,
  BLACK,
  CODE,
  type Dc,
  type Frame,
  LABEL,
  SAMPLE,
  SMALL,
  STAT,
  TRANSPARENT,
  center,
  drawKey,
  drawTicks,
  drawTicksAt,
  drift,
  fitStat,
  month,
  otpText,
  pad,
  remaining,
  text,
  weekday,
} from './watch-face-dc';

const DIAL = 0xeae6dc;
const INK = 0x242b25;
const RUST = 0xad5f3c;

function hand(
  dc: Dc,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  width: number,
  color: number,
) {
  const x = cx + Math.sin(angle) * length;
  const y = cy - Math.cos(angle) * length;
  dc.setColor(color, TRANSPARENT);
  dc.setPenWidth(width);
  dc.drawLine(cx, cy, x, y);
  dc.fillCircle(x, y, Math.floor(width / 2));
  dc.setPenWidth(1);
}

function hands(dc: Dc, frame: Frame, cx: number, cy: number, low: boolean) {
  const minutes = frame.min + (low ? 0 : frame.sec / 60);
  const hourAngle = (((frame.hour % 12) + minutes / 60) * Math.PI) / 6;
  const minuteAngle = (minutes * Math.PI) / 30;
  hand(dc, cx, cy, hourAngle, 99, low ? 5 : 11, low ? 0xa2a69b : INK);
  hand(dc, cx, cy, minuteAngle, 133, low ? 3 : 7, low ? 0xbbc0b2 : INK);
  if (!low) {
    const angle = (frame.sec * Math.PI) / 30;
    dc.setColor(RUST, TRANSPARENT);
    dc.setPenWidth(2);
    dc.drawLine(
      cx - Math.sin(angle) * 33,
      cy + Math.cos(angle) * 33,
      cx + Math.sin(angle) * 134,
      cy - Math.cos(angle) * 134,
    );
    dc.setPenWidth(1);
  }
  dc.setColor(low ? 0xa2a69b : INK, TRANSPARENT);
  dc.fillCircle(cx, cy, low ? 4 : 8);
  if (!low) {
    dc.setColor(RUST, TRANSPARENT);
    dc.fillCircle(cx, cy, 3);
  }
}

export function drawActive(dc: Dc, frame: Frame) {
  dc.setColor(DIAL, DIAL);
  dc.clear();
  dc.setColor(0xc6c2b8, TRANSPARENT);
  dc.drawCircle(208, 208, 191);
  drawTicks(dc, 179, 171, 185, 0xa4a69a, 0x50594d);
  center(dc, 43, STAT, '12', 0x252823);
  text(dc, 362, 199, STAT, '3', 0x252823, 'center');
  text(dc, 54, 199, STAT, '9', 0x252823, 'center');
  center(dc, 98, LABEL, 'A T E L I E R', 0x252823);
  dc.setColor(0xddd8cc, TRANSPARENT);
  dc.fillRoundedRectangle(282, 185, 43, 34, 3);
  text(dc, 304, 193, LABEL, pad(frame.day), 0x393c34, 'center');
  hands(dc, frame, 208, 206, false);
  if (frame.code) {
    // The code window overlays hands so all six digits stay readable.
    dc.setColor(0x252b25, TRANSPARENT);
    dc.fillRoundedRectangle(104, 283, 208, 47, 8);
    drawKey(dc, 118, 299, 0xbac6b6);
    const left = remaining(frame);
    text(
      dc,
      229,
      297,
      CODE,
      otpText(frame),
      left <= 5 ? 0xf1c17b : 0xf3f0e6,
      'center',
    );
    dc.setColor(0x4b5349, TRANSPARENT);
    dc.fillRectangle(176, 322, 106, 2);
    dc.setColor(left <= 5 ? 0xf1c17b : 0xbac6b6, TRANSPARENT);
    dc.fillRectangle(176, 322, Math.floor((106 * left) / 30), 2);
  }
  center(dc, 360, SMALL, `BATTERY ${SAMPLE.battery}`, 0x73786e);
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  const { dx, dy } = drift(frame);
  dc.setColor(0x32392f, TRANSPARENT);
  dc.drawCircle(208 + dx, 208 + dy, 191);
  drawTicksAt(dc, 208 + dx, 208 + dy, 179, 170, 185, 0x444b40, 0x888f7f);
  text(dc, 208 + dx, 43 + dy, STAT, '12', 0xb1b5a7, 'center');
  text(dc, 362 + dx, 199 + dy, STAT, '3', 0xb1b5a7, 'center');
  text(dc, 54 + dx, 199 + dy, STAT, '9', 0xb1b5a7, 'center');
  text(dc, 208 + dx, 98 + dy, LABEL, 'A T E L I E R', 0x878e7f, 'center');
  hands(dc, frame, 208 + dx, 206 + dy, true);
  // Date and lower complications remain readable even when hands pass them.
  dc.setColor(BLACK, TRANSPARENT);
  dc.fillRoundedRectangle(281 + dx, 184 + dy, 45, 36, 3);
  dc.setColor(0x4f5848, TRANSPARENT);
  dc.drawRoundedRectangle(281 + dx, 184 + dy, 45, 36, 3);
  text(dc, 304 + dx, 193 + dy, LABEL, pad(frame.day), 0xafb6a4, 'center');
  dc.setColor(BLACK, TRANSPARENT);
  dc.fillRoundedRectangle(96 + dx, 281 + dy, 224, 57, 8);
  dc.setColor(0x363f32, TRANSPARENT);
  dc.drawRoundedRectangle(96 + dx, 281 + dy, 224, 57, 8);
  dc.drawLine(208 + dx, 288 + dy, 208 + dx, 329 + dy);
  text(dc, 152 + dx, 289 + dy, SMALL, 'STEPS', 0x727e6a, 'center');
  text(dc, 264 + dx, 289 + dy, SMALL, 'BATTERY', 0x727e6a, 'center');
  fitStat(dc, 152 + dx, 310 + dy, SAMPLE.steps, 0xa3ac98, 98);
  fitStat(dc, 264 + dx, 310 + dy, SAMPLE.battery, 0xa3ac98, 98);
  text(
    dc,
    208 + dx,
    359 + dy,
    AOD_DATE,
    `${weekday(frame)} / ${month(frame)}`,
    0x8a9184,
    'center',
  );
}
