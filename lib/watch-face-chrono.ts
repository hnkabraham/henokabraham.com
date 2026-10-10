// Chrono, from ChronoView.mc: a pilot's dial with three data subdials.
import {
  AOD_DATE,
  BLACK,
  CODE,
  type Dc,
  type Frame,
  SAMPLE,
  SMALL,
  STAT,
  TRANSPARENT,
  drawKey,
  drawTicks,
  drawTicksAt,
  drift,
  otpText,
  pad,
  remaining,
  text,
  weekday,
} from './watch-face-dc';

const LUME_MINT = 0xb4e8c2;
const LUME_DIM = 0x6e9a7b;
const SIGNAL_RED = 0xe54d42;
const DIAL_RING = 0x242d33;
const DIAL_SUB = 0x141a1e;
const TEXT_LIGHT = 0xe6edf2;
const TEXT_MUTED = 0x7e8c96;
const GOLD = 0xf1c17b;

const batteryRatio = SAMPLE.batteryLevel / 100;
const heartRatio = (SAMPLE.heartRateValue - 50) / 130;

function subDial(
  dc: Dc,
  cx: number,
  cy: number,
  radius: number,
  label: string,
  ratio: number,
  needleColor: number,
) {
  dc.setColor(DIAL_SUB, TRANSPARENT);
  dc.fillCircle(cx, cy, radius);
  dc.setColor(0x323e46, TRANSPARENT);
  dc.setPenWidth(1);
  dc.drawCircle(cx, cy, radius);
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    const inner = radius - (i % 3 === 0 ? 6 : 3);
    dc.setColor(i % 3 === 0 ? TEXT_LIGHT : TEXT_MUTED, TRANSPARENT);
    dc.drawLine(
      cx + Math.sin(angle) * inner,
      cy - Math.cos(angle) * inner,
      cx + Math.sin(angle) * (radius - 1),
      cy - Math.cos(angle) * (radius - 1),
    );
  }
  const needleAngle =
    -Math.PI * 0.75 + Math.min(1, Math.max(0, ratio)) * Math.PI * 1.5;
  dc.setColor(needleColor, TRANSPARENT);
  dc.setPenWidth(2);
  dc.drawLine(
    cx,
    cy,
    cx + Math.sin(needleAngle) * (radius - 8),
    cy - Math.cos(needleAngle) * (radius - 8),
  );
  dc.fillCircle(cx, cy, 3);
  dc.setPenWidth(1);
  text(dc, cx, cy - radius + 11, SMALL, label, TEXT_MUTED, 'center');
}

function swordHand(
  dc: Dc,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  width: number,
  color: number,
  outlineOnly: boolean,
) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = width / 2;
  const tipX = cx + sin * length;
  const tipY = cy - cos * length;
  const shoulderX = cx + sin * (length - 14);
  const shoulderY = cy - cos * (length - 14);
  const points: [number, number][] = [
    [cx - cos * half, cy - sin * half],
    [shoulderX - cos * half, shoulderY - sin * half],
    [tipX, tipY],
    [shoulderX + cos * half, shoulderY + sin * half],
    [cx + cos * half, cy + sin * half],
  ];
  const outline = () => {
    points.forEach(([x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      dc.drawLine(x, y, nx, ny);
    });
  };
  dc.setColor(color, TRANSPARENT);
  if (outlineOnly) {
    outline();
    return;
  }
  dc.fillPolygon(points);
  dc.setColor(0x0c1216, TRANSPARENT);
  dc.setPenWidth(1);
  outline();
  dc.drawLine(cx, cy, tipX, tipY);
}

function hands(dc: Dc, frame: Frame, cx: number, cy: number, low: boolean) {
  const minutes = frame.min + (low ? 0 : frame.sec / 60);
  const hourAngle = (((frame.hour % 12) + minutes / 60) * Math.PI) / 6;
  const minuteAngle = (minutes * Math.PI) / 30;
  swordHand(dc, cx, cy, hourAngle, 86, 9, low ? LUME_DIM : LUME_MINT, low);
  swordHand(dc, cx, cy, minuteAngle, 134, 7, low ? LUME_DIM : LUME_MINT, low);
  dc.setColor(low ? 0x2a353b : 0x182024, TRANSPARENT);
  dc.fillCircle(cx, cy, 9);
  dc.setColor(low ? LUME_DIM : LUME_MINT, TRANSPARENT);
  dc.drawCircle(cx, cy, 9);
  if (!low) {
    const angle = (frame.sec * Math.PI) / 30;
    const tailX = cx - Math.sin(angle) * 28;
    const tailY = cy + Math.cos(angle) * 28;
    dc.setColor(SIGNAL_RED, TRANSPARENT);
    dc.setPenWidth(2);
    dc.drawLine(
      tailX,
      tailY,
      cx + Math.sin(angle) * 144,
      cy - Math.cos(angle) * 144,
    );
    dc.fillCircle(cx, cy, 4);
    dc.fillCircle(tailX, tailY, 5);
    dc.setPenWidth(1);
  }
}

export function drawActive(dc: Dc, frame: Frame) {
  dc.setColor(BLACK, BLACK);
  dc.clear();
  dc.setColor(DIAL_RING, TRANSPARENT);
  dc.drawCircle(208, 208, 198);
  drawTicks(dc, 188, 180, 198, 0x334048, 0x768792);
  // The pilot's triangle and two dots at twelve.
  dc.setColor(LUME_MINT, TRANSPARENT);
  dc.fillPolygon([
    [208, 18],
    [202, 28],
    [214, 28],
  ]);
  dc.fillCircle(196, 23, 2);
  dc.fillCircle(220, 23, 2);
  subDial(dc, 208, 102, 38, 'GOAL', SAMPLE.stepProgress, LUME_MINT);
  subDial(dc, 114, 208, 38, 'BATT', batteryRatio, LUME_MINT);
  subDial(dc, 302, 208, 38, 'PULSE', heartRatio, SIGNAL_RED);
  dc.setColor(0x101518, TRANSPARENT);
  dc.fillRoundedRectangle(276, 276, 38, 24, 3);
  dc.setColor(0x3b4852, TRANSPARENT);
  dc.drawRoundedRectangle(276, 276, 38, 24, 3);
  text(dc, 295, 281, STAT, pad(frame.day), TEXT_LIGHT, 'center');
  text(dc, 114, 278, SMALL, 'CHRONO', TEXT_MUTED, 'center');
  hands(dc, frame, 208, 208, false);
  // Readouts are stamped over the hands so they stay legible.
  text(
    dc,
    208,
    102 + 38 - 18,
    STAT,
    SAMPLE.stepGoalPercent,
    TEXT_LIGHT,
    'center',
  );
  text(dc, 114, 208 + 38 - 18, STAT, SAMPLE.battery, TEXT_LIGHT, 'center');
  text(dc, 302, 208 + 38 - 18, STAT, SAMPLE.heartRate, TEXT_LIGHT, 'center');
  if (frame.code) {
    // Drawn last so a hand never crosses the code.
    dc.setColor(0x0c1216, TRANSPARENT);
    dc.fillRoundedRectangle(112, 318, 192, 44, 4);
    dc.setColor(0x28333b, TRANSPARENT);
    dc.drawRoundedRectangle(112, 318, 192, 44, 4);
    drawKey(dc, 122, 334, LUME_MINT);
    const left = remaining(frame);
    text(
      dc,
      222,
      330,
      CODE,
      otpText(frame),
      left <= 5 ? GOLD : TEXT_LIGHT,
      'center',
    );
    dc.setColor(0x202b32, TRANSPARENT);
    dc.fillRectangle(154, 354, 134, 2);
    dc.setColor(left <= 5 ? GOLD : LUME_MINT, TRANSPARENT);
    dc.fillRectangle(154, 354, Math.floor((134 * left) / 30), 2);
  }
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  const { dx, dy } = drift(frame);
  const cx = 208 + dx;
  const cy = 208 + dy;
  dc.setColor(0x1b2328, TRANSPARENT);
  dc.drawCircle(cx, cy, 198);
  drawTicksAt(dc, cx, cy, 188, 182, 198, 0x222c32, 0x485862);
  dc.setColor(LUME_DIM, TRANSPARENT);
  const triangle: [number, number][] = [
    [cx, 18 + dy],
    [cx - 6, 28 + dy],
    [cx + 6, 28 + dy],
  ];
  triangle.forEach(([x, y], i) => {
    const [nx, ny] = triangle[(i + 1) % 3];
    dc.drawLine(x, y, nx, ny);
  });
  dc.setColor(0x202a30, TRANSPARENT);
  dc.drawCircle(cx, 102 + dy, 38);
  dc.drawCircle(114 + dx, cy, 38);
  dc.drawCircle(302 + dx, cy, 38);
  text(dc, cx, 88 + dy, SMALL, 'GOAL', 0x56656e, 'center');
  text(dc, 114 + dx, cy - 14, SMALL, 'BATT', 0x56656e, 'center');
  text(dc, 302 + dx, cy - 14, SMALL, 'PULSE', 0x56656e, 'center');
  hands(dc, frame, cx, cy, true);
  text(dc, cx, 106 + dy, AOD_DATE, SAMPLE.stepGoalPercent, 0x8898a2, 'center');
  text(dc, 114 + dx, cy + 4, AOD_DATE, SAMPLE.battery, 0x8898a2, 'center');
  text(dc, 302 + dx, cy + 4, AOD_DATE, SAMPLE.heartRate, 0x8898a2, 'center');
  text(
    dc,
    cx,
    284 + dy,
    SMALL,
    `${weekday(frame)} ${pad(frame.day)}`,
    0x56656e,
    'center',
  );
  text(dc, cx, 332 + dy, SMALL, `STEPS ${SAMPLE.steps}`, 0x6e7f8a, 'center');
}
