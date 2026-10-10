// Tactical, from TacticalView.mc: an amber head-up display over a compass rose.
import {
  AOD,
  AOD_DATE,
  BLACK,
  CLOCK,
  CODE,
  type Dc,
  type Frame,
  HEART_HISTORY,
  LABEL,
  SAMPLE,
  SMALL,
  STAT,
  TRANSPARENT,
  center,
  clockText,
  dateText,
  drawKey,
  drift,
  fitStat,
  otpText,
  remaining,
  text,
} from './watch-face-dc';

const AMBER = 0xffa000;
const AMBER_DIM = 0x996000;
const GREEN = 0x30d158;
const WHITE = 0xf4f6f8;
const WHITE_DIM = 0x88929a;
const GRID = 0x222c34;
const PANEL = 0x0e1419;

function compassTicks(
  dc: Dc,
  cx: number,
  cy: number,
  radius: number,
  color: number,
) {
  dc.setColor(color, TRANSPARENT);
  for (let i = 0; i < 24; i++) {
    const angle = (i * Math.PI) / 12;
    const cardinal = i % 6 === 0;
    const inner = radius - (cardinal ? 10 : 5);
    dc.setPenWidth(cardinal ? 2 : 1);
    dc.drawLine(
      cx + Math.sin(angle) * inner,
      cy - Math.cos(angle) * inner,
      cx + Math.sin(angle) * radius,
      cy - Math.cos(angle) * radius,
    );
  }
  dc.setPenWidth(1);
  text(dc, cx, cy - radius + 12, SMALL, 'N', AMBER, 'center');
  text(dc, cx + radius - 24, cy - 8, SMALL, 'E', WHITE_DIM, 'center');
  text(dc, cx, cy + radius - 20, SMALL, 'S', WHITE_DIM, 'center');
  text(dc, cx - radius + 24, cy - 8, SMALL, 'W', WHITE_DIM, 'center');
}

function batteryArc(
  dc: Dc,
  cx: number,
  cy: number,
  radius: number,
  percent: number,
  color: number,
) {
  const segments = 10;
  const lit = Math.min(segments, Math.floor((percent / 100) * segments));
  const span = 90 / segments;
  for (let s = 0; s < segments; s++) {
    const start = ((225 + s * span) * Math.PI) / 180;
    const end = ((225 + (s + 0.8) * span) * Math.PI) / 180;
    dc.setColor(s < lit ? color : 0x1e272e, TRANSPARENT);
    dc.setPenWidth(6);
    dc.drawLine(
      cx + Math.cos(start) * radius,
      cy + Math.sin(start) * radius,
      cx + Math.cos(end) * radius,
      cy + Math.sin(end) * radius,
    );
  }
  dc.setPenWidth(1);
}

function heartSparkline(
  dc: Dc,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
) {
  const history = HEART_HISTORY.slice(-20);
  let min = 200;
  let max = 50;
  for (const v of history) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) max = min + 10;
  dc.setColor(color, TRANSPARENT);
  dc.setPenWidth(2);
  let previous: [number, number] | null = null;
  history.forEach((v, i) => {
    const px = x + (i / (history.length - 1)) * width;
    const py = y + height - 2 - ((v - min) / (max - min)) * (height - 4);
    if (previous) dc.drawLine(previous[0], previous[1], px, py);
    previous = [px, py];
  });
  dc.setPenWidth(1);
}

export function drawActive(dc: Dc, frame: Frame) {
  dc.setColor(BLACK, BLACK);
  dc.clear();
  compassTicks(dc, 208, 208, 198, GRID);
  batteryArc(dc, 208, 208, 172, SAMPLE.batteryLevel, AMBER);
  text(dc, 208, 52, SMALL, `BATT ${SAMPLE.battery}`, AMBER, 'center');
  // The armoured panel around the clock, with chamfered corners.
  dc.setColor(PANEL, TRANSPARENT);
  dc.fillRoundedRectangle(44, 94, 328, 102, 6);
  dc.setColor(AMBER, TRANSPARENT);
  dc.setPenWidth(2);
  dc.drawRoundedRectangle(44, 94, 328, 102, 6);
  dc.drawLine(44, 114, 64, 94);
  dc.drawLine(372, 114, 352, 94);
  dc.drawLine(44, 176, 64, 196);
  dc.drawLine(372, 176, 352, 196);
  dc.setPenWidth(1);
  center(dc, 100, CLOCK, clockText(frame), WHITE);
  center(dc, 76, LABEL, dateText(frame), WHITE_DIM);
  dc.setColor(GRID, TRANSPARENT);
  dc.drawLine(52, 204, 364, 204);
  text(dc, 86, 210, SMALL, 'PULSE', WHITE_DIM, 'left');
  text(dc, 86, 226, STAT, `${SAMPLE.heartRate} BPM`, AMBER, 'left');
  heartSparkline(dc, 180, 214, 76, 32, GREEN);
  text(dc, 330, 210, SMALL, 'STEPS', WHITE_DIM, 'right');
  text(dc, 330, 226, STAT, SAMPLE.steps, WHITE, 'right');
  dc.setColor(0x1b242c, TRANSPARENT);
  dc.fillRectangle(74, 260, 268, 4);
  dc.setColor(GREEN, TRANSPARENT);
  dc.fillRectangle(74, 260, 268 * SAMPLE.stepProgress, 4);
  if (frame.code) {
    dc.setColor(PANEL, TRANSPARENT);
    dc.fillRoundedRectangle(80, 282, 256, 52, 5);
    dc.setColor(0x32404d, TRANSPARENT);
    dc.drawRoundedRectangle(80, 282, 256, 52, 5);
    drawKey(dc, 96, 302, AMBER);
    const left = remaining(frame);
    text(
      dc,
      232,
      298,
      CODE,
      otpText(frame),
      left <= 5 ? 0xff3b30 : WHITE,
      'center',
    );
    // A countdown in six five-second segments.
    for (let b = 0; b < 6; b++) {
      const fill = left - b * 5;
      dc.setColor(0x222e38, TRANSPARENT);
      dc.fillRectangle(146 + b * 22, 326, 17, 3);
      if (fill > 0) {
        dc.setColor(left <= 5 ? 0xff3b30 : AMBER, TRANSPARENT);
        dc.fillRectangle(
          146 + b * 22,
          326,
          fill >= 5 ? 17 : Math.floor((17 * fill) / 5),
          3,
        );
      }
    }
  }
  center(dc, 350, SMALL, 'TACTICAL OPS', WHITE_DIM);
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  const { dx, dy } = drift(frame);
  const cx = 208 + dx;
  const cy = 208 + dy;
  dc.setColor(0x1b2329, TRANSPARENT);
  dc.drawCircle(cx, cy, 198);
  dc.setColor(0x28323a, TRANSPARENT);
  dc.drawRoundedRectangle(44 + dx, 102 + dy, 328, 88, 6);
  text(dc, cx, 108 + dy, AOD, clockText(frame), AMBER_DIM, 'center');
  text(dc, cx, 78 + dy, AOD_DATE, dateText(frame), 0x647480, 'center');
  dc.setColor(0x1e262c, TRANSPARENT);
  dc.drawLine(60 + dx, 210 + dy, 356 + dx, 210 + dy);
  text(dc, 120 + dx, 222 + dy, SMALL, 'BATT', 0x5c6c78, 'center');
  text(dc, 120 + dx, 240 + dy, AOD_DATE, SAMPLE.battery, 0x889aa6, 'center');
  text(dc, cx, 222 + dy, SMALL, 'STEPS', 0x5c6c78, 'center');
  fitStat(dc, cx, 240 + dy, SAMPLE.steps, 0x889aa6, 90);
  text(dc, 296 + dx, 222 + dy, SMALL, 'GOAL', 0x5c6c78, 'center');
  text(
    dc,
    296 + dx,
    240 + dy,
    AOD_DATE,
    SAMPLE.stepGoalPercent,
    0x889aa6,
    'center',
  );
  text(dc, cx, 300 + dy, SMALL, 'STANDBY', 0x485864, 'center');
}
