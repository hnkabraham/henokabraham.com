// Words, from WordsView.mc: the time to the nearest five minutes, in words.
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
  STAT,
  TRANSPARENT,
  center,
  clockText,
  drift,
  month,
  otpText,
  pad,
  remaining,
  text,
} from './watch-face-dc';

const HOURS = [
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
  'TEN',
  'ELEVEN',
  'TWELVE',
];
const WHITE = 0xffffff;
const WHITE_DIM = 0x8a949e;
const PILL = 0x14181b;

export function wordTime(frame: Frame): string[] {
  let hour = frame.hour;
  let m = Math.floor((frame.min + 2) / 5) * 5;
  if (m >= 60) {
    m = 0;
    hour += 1;
  }
  if (m > 30) hour += 1;
  hour %= 12;
  if (hour === 0) hour = 12;
  const name = HOURS[hour - 1];
  switch (m) {
    case 0:
      return [name, "O'CLOCK"];
    case 5:
      return ['FIVE PAST', name];
    case 10:
      return ['TEN PAST', name];
    case 15:
      return ['QUARTER PAST', name];
    case 20:
      return ['TWENTY PAST', name];
    case 25:
      return ['TWENTY FIVE', `PAST ${name}`];
    case 30:
      return ['HALF PAST', name];
    case 35:
      return ['TWENTY FIVE', `TO ${name}`];
    case 40:
      return ['TWENTY TO', name];
    case 45:
      return ['QUARTER TO', name];
    case 50:
      return ['TEN TO', name];
    default:
      return ['FIVE TO', name];
  }
}

export function drawActive(dc: Dc, frame: Frame) {
  dc.setColor(BLACK, BLACK);
  dc.clear();
  const lines = wordTime(frame);
  const lineHeight = 55;
  const top = 166 - Math.floor((lines.length * lineHeight) / 2);
  lines.forEach((line, i) =>
    center(dc, top + i * lineHeight, CLOCK, line, WHITE),
  );
  center(dc, 273, LABEL, `${month(frame)} ${pad(frame.day)}`, WHITE_DIM);
  center(dc, 297, STAT, `${SAMPLE.steps} STEPS`, WHITE);
  if (frame.code) {
    dc.setColor(PILL, TRANSPARENT);
    dc.fillRoundedRectangle(112, 332, 192, 38, 19);
    dc.setColor(0x283036, TRANSPARENT);
    dc.drawRoundedRectangle(112, 332, 192, 38, 19);
    const left = remaining(frame);
    dc.setColor(left <= 5 ? 0xff3b30 : 0xffd600, TRANSPARENT);
    dc.fillCircle(132, 351, 4);
    text(dc, 222, 342, CODE, otpText(frame), WHITE, 'center');
  }
  text(dc, 208, 12, SMALL, SAMPLE.battery, 0x55626d, 'center');
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  const { dx, dy } = drift(frame);
  const cx = 208 + dx;
  text(dc, cx, 160 + dy, AOD, clockText(frame), 0x7e8b95, 'center');
  text(
    dc,
    cx,
    264 + dy,
    AOD_DATE,
    `${month(frame)} ${pad(frame.day)}`,
    0x64727d,
    'center',
  );
  text(
    dc,
    cx,
    292 + dy,
    SMALL,
    `${SAMPLE.steps} / ${SAMPLE.battery}`,
    0x56646f,
    'center',
  );
}
