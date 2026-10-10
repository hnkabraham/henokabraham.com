// Orbit, from OrbitView.mc: a planet and crescent moon inside three activity
// orbits.
import {
  AOD,
  AOD_DATE,
  BLACK,
  CLOCK,
  CODE,
  type Dc,
  type Frame,
  LABEL,
  SAMPLE,
  SMALL,
  TRANSPARENT,
  WHITE,
  center,
  clockText,
  drawKey,
  drift,
  month,
  otpText,
  pad,
  remaining,
  text,
  weekday,
} from './watch-face-dc';

const CYAN = 0x00e5ff;
const CYAN_DIM = 0x007885;
const AMBER = 0xff9100;
const LIGHT = 0xf0f4f8;
const LIGHT_DIM = 0x6e7b86;
const TRACK = 0x141c24;
// The watch-face API exposes no calorie goal, so the face uses a fixed target.
const CALORIE_GOAL = 2200;

const batteryRatio = SAMPLE.batteryLevel / 100;
const calorieRatio = Math.min(1, SAMPLE.caloriesValue / CALORIE_GOAL);

function orbitArc(
  dc: Dc,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  progress: number,
  color: number,
  trackColor: number,
  satellite: boolean,
) {
  const fraction = Math.min(1, Math.max(0, progress));
  const start = 140;
  const span = 260;
  const steps = 36;
  const segment = (i: number) => {
    const a1 = ((start + (i / steps) * span) * Math.PI) / 180;
    const a2 = ((start + ((i + 1.1) / steps) * span) * Math.PI) / 180;
    dc.drawLine(
      cx + Math.cos(a1) * radius,
      cy + Math.sin(a1) * radius,
      cx + Math.cos(a2) * radius,
      cy + Math.sin(a2) * radius,
    );
  };
  dc.setColor(trackColor, TRANSPARENT);
  dc.setPenWidth(width);
  for (let i = 0; i < steps; i++) segment(i);
  const active = Math.floor(fraction * steps);
  dc.setColor(color, TRANSPARENT);
  for (let i = 0; i < active; i++) segment(i);
  if (satellite && fraction > 0.02) {
    const angle = ((start + fraction * span) * Math.PI) / 180;
    const sx = cx + Math.cos(angle) * radius;
    const sy = cy + Math.sin(angle) * radius;
    dc.setColor(color, TRANSPARENT);
    dc.fillCircle(sx, sy, width + 1);
    dc.setColor(WHITE, TRANSPARENT);
    dc.fillCircle(sx, sy, width - 1);
  }
  dc.setPenWidth(1);
}

function celestialCenter(dc: Dc, cx: number, cy: number, low: boolean) {
  dc.setColor(low ? 0x1a232c : 0x24323e, TRANSPARENT);
  dc.setPenWidth(1);
  dc.drawCircle(cx, cy, 32);
  dc.setColor(low ? 0x14202a : 0x1c3a50, TRANSPARENT);
  dc.fillCircle(cx, cy, 22);
  if (!low) {
    dc.setColor(0x286566, TRANSPARENT);
    dc.fillCircle(cx - 5, cy - 4, 11);
    dc.setColor(0x35827c, TRANSPARENT);
    dc.fillCircle(cx + 6, cy + 6, 7);
    dc.setColor(LIGHT, TRANSPARENT);
    dc.fillCircle(cx - 14, cy - 8, 12);
    dc.setColor(BLACK, TRANSPARENT);
    dc.fillCircle(cx - 10, cy - 7, 10);
  } else {
    // A stroked crescent, lighting no more pixels than the circle it replaces.
    dc.setColor(LIGHT_DIM, TRANSPARENT);
    dc.drawArc(cx - 6, cy, 22, true, 74, 286);
    dc.drawArc(cx + 6, cy, 22, true, 106, 254);
  }
}

export function drawActive(dc: Dc, frame: Frame) {
  dc.setColor(BLACK, BLACK);
  dc.clear();
  const cx = 208;
  const cy = 208;
  orbitArc(dc, cx, cy, 186, 3, SAMPLE.stepProgress, CYAN, TRACK, true);
  orbitArc(dc, cx, cy, 168, 3, calorieRatio, AMBER, TRACK, true);
  orbitArc(dc, cx, cy, 150, 3, batteryRatio, LIGHT, TRACK, false);
  text(dc, cx, 69, SMALL, `${SAMPLE.battery} BATT`, LIGHT, 'center');
  text(dc, cx, 82, SMALL, `${SAMPLE.calories} KCAL`, AMBER, 'center');
  text(dc, cx, 95, SMALL, `${SAMPLE.steps} STEPS`, CYAN, 'center');
  celestialCenter(dc, cx, 142, false);
  center(dc, 184, CLOCK, clockText(frame), LIGHT);
  center(
    dc,
    252,
    LABEL,
    `${weekday(frame)} ${pad(frame.day)} ${month(frame)}`,
    LIGHT_DIM,
  );
  if (frame.code) {
    dc.setColor(0x0c1218, TRANSPARENT);
    dc.fillRoundedRectangle(108, 306, 200, 44, 22);
    dc.setColor(0x283846, TRANSPARENT);
    dc.drawRoundedRectangle(108, 306, 200, 44, 22);
    drawKey(dc, 122, 322, CYAN);
    const left = remaining(frame);
    text(
      dc,
      224,
      318,
      CODE,
      otpText(frame),
      left <= 5 ? 0xff5252 : LIGHT,
      'center',
    );
    // A satellite runs the countdown along its track.
    dc.setColor(0x22303c, TRANSPARENT);
    dc.drawLine(148, 342, 278, 342);
    dc.setColor(left <= 5 ? 0xff5252 : CYAN, TRANSPARENT);
    dc.fillCircle(148 + Math.floor((130 * left) / 30), 342, 3);
  }
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  const { dx, dy } = drift(frame);
  const cx = 208 + dx;
  const cy = 208 + dy;
  orbitArc(dc, cx, cy, 186, 1, SAMPLE.stepProgress, CYAN_DIM, 0x10161c, false);
  orbitArc(dc, cx, cy, 150, 1, batteryRatio, LIGHT_DIM, 0x10161c, false);
  celestialCenter(dc, cx, 142 + dy, true);
  text(dc, cx, 194 + dy, AOD, clockText(frame), 0x90a0b0, 'center');
  text(
    dc,
    cx,
    260 + dy,
    AOD_DATE,
    `${month(frame)} ${pad(frame.day)}`,
    0x607080,
    'center',
  );
  text(
    dc,
    cx,
    320 + dy,
    SMALL,
    `GOAL ${SAMPLE.stepGoalPercent} / ${SAMPLE.battery}`,
    0x506070,
    'center',
  );
}
