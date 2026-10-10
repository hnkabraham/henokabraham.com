// Summit, from SummitView.mc with its default settings: an orange sports dial
// over an alpine ridge. Awake and always-on share one composition; standby
// dims the lit details and drifts the whole face.
import {
  AOD,
  BLACK,
  CLOCK,
  CODE,
  type Dc,
  type Frame,
  HEART_HISTORY,
  type Justify,
  LABEL,
  SAMPLE,
  SMALL,
  STAT,
  TRANSPARENT,
  drawKey,
  drift,
  fitStat,
  month,
  otpText,
  pad,
  remaining,
  text as plainText,
  weekday,
} from './watch-face-dc';

const ORANGE = 0xfa7413;
const ORANGE_STANDBY = 0xb8743e;
const WHITE = 0xf1f2f2;
const MUTED = 0x979c9e;
const LINE = 0x292c2e;
const RED = 0xf14b40;

// The face's Lucide symbols (ISC licence, as the site's other icons), drawn
// at the sizes its resources scale them to.
const SYMBOLS: [paths: string[], width: number, height: number][] = [
  [
    [
      'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
      'M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27',
    ],
    26,
    26,
  ],
  [
    [
      'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z',
      'M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z',
      'M16 17h4',
      'M4 13h4',
    ],
    24,
    24,
  ],
  [
    [
      'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
    ],
    24,
    24,
  ],
  [
    [
      'M22 14V10',
      'M4 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
    ],
    28,
    24,
  ],
  [
    [
      'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528',
    ],
    22,
    22,
  ],
];
const HEART = 0;
const STEPS = 1;
const CALORIES = 2;
const BATTERY = 3;
const GOAL = 4;

// One drawing pass, awake or in standby.
class Composition {
  readonly dc: Dc;
  readonly frame: Frame;
  readonly standby: boolean;
  readonly mountain: CanvasImageSource | null;
  readonly sx: number;
  readonly sy: number;

  constructor(
    dc: Dc,
    frame: Frame,
    standby: boolean,
    mountain: CanvasImageSource | null,
  ) {
    this.dc = dc;
    this.frame = frame;
    this.standby = standby;
    this.mountain = mountain;
    const { dx, dy } = standby ? drift(frame) : { dx: 0, dy: 0 };
    this.sx = dx;
    this.sy = dy;
  }

  // The standby palette dims only lit details; the background stays black.
  tone(color: number) {
    if (color === ORANGE) return this.standby ? ORANGE_STANDBY : ORANGE;
    if (!this.standby) return color;
    const standby: Record<number, number> = {
      [WHITE]: 0x949ea3,
      [MUTED]: 0x616c71,
      [LINE]: 0x303b40,
      [RED]: 0xac574a,
      0x393d3f: 0x354047,
      0x81878a: 0x6b767b,
      0x8b8f90: 0x647177,
      0x121517: BLACK,
      0x363c40: 0x444f55,
      0x242a2e: 0x303b42,
    };
    return standby[color] ?? color;
  }

  ink(color: number) {
    this.dc.setColor(this.tone(color), TRANSPARENT);
  }

  text = (
    _dc: Dc,
    x: number,
    y: number,
    slot: number,
    value: string,
    color: number,
    justify: Justify,
  ) =>
    plainText(
      this.dc,
      x + this.sx,
      y + this.sy,
      slot,
      value,
      this.tone(color),
      justify,
    );

  center(y: number, slot: number, value: string, color: number) {
    this.text(this.dc, 208, y, slot, value, color, 'center');
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    this.dc.drawLine(x1 + this.sx, y1 + this.sy, x2 + this.sx, y2 + this.sy);
  }

  rectangle(x: number, y: number, width: number, height: number) {
    this.dc.fillRectangle(x + this.sx, y + this.sy, width, height);
  }

  symbol(index: number, x: number, y: number, color: number) {
    const { ctx } = this.dc;
    const [paths, width, height] = SYMBOLS[index];
    ctx.save();
    ctx.translate(x + this.sx, y + this.sy);
    ctx.scale(width / 24, height / 24);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `#${this.tone(color).toString(16).padStart(6, '0')}`;
    for (const path of paths) ctx.stroke(new Path2D(path));
    ctx.restore();
  }

  ticks() {
    const { dc } = this;
    for (let i = 0; i < 60; i++) {
      const angle = (i * Math.PI) / 30;
      const major = i % 5 === 0;
      const radius = major ? 188 : 193;
      this.ink(major ? 0x81878a : 0x393d3f);
      dc.setPenWidth(major ? 2 : 1);
      this.line(
        208 + Math.sin(angle) * radius,
        208 - Math.cos(angle) * radius,
        208 + Math.sin(angle) * 199,
        208 - Math.cos(angle) * 199,
      );
    }
    dc.setPenWidth(1);
  }

  ridge() {
    if (!this.mountain) return;
    // The face dims its artwork with a translucent black overlay: shade 25 of
    // 255 awake, 85 in standby, at the default "Normal" brightness.
    const { ctx } = this.dc;
    ctx.drawImage(this.mountain, 16 + this.sx, 170 + this.sy, 384, 128);
    ctx.fillStyle = `rgba(0, 0, 0, ${(this.standby ? 85 : 25) / 255})`;
    ctx.fillRect(16 + this.sx, 170 + this.sy, 384, 128);
  }

  heartGraph(cx: number) {
    // Readings a minute apart over the last half hour, scaled by their times.
    let low = Math.min(...HEART_HISTORY);
    let high = Math.max(...HEART_HISTORY);
    if (high - low < 12) {
      const mid = Math.floor((high + low) / 2);
      low = mid - 6;
      high = mid + 6;
    }
    const last = HEART_HISTORY.length - 1;
    this.ink(RED);
    this.dc.setPenWidth(2);
    HEART_HISTORY.forEach((value, index) => {
      if (!index) return;
      const before = HEART_HISTORY[index - 1];
      this.line(
        cx - 54 + (107 * (index - 1)) / last,
        144 - (17 * (before - low)) / (high - low),
        cx - 54 + (107 * index) / last,
        144 - (17 * (value - low)) / (high - low),
      );
    });
    this.dc.setPenWidth(1);
  }

  goalRing(cx: number) {
    // A 270-degree segmented ring follows the day's step goal.
    this.dc.setPenWidth(6);
    for (let i = 0; i < 36; i++) {
      const angle = ((-135 + i * 7.5) * Math.PI) / 180;
      const end = ((-135 + i * 7.5 + 6) * Math.PI) / 180;
      this.ink(i < SAMPLE.stepProgress * 36 ? ORANGE : LINE);
      this.line(
        cx + Math.sin(angle) * 33,
        114 - Math.cos(angle) * 33,
        cx + Math.sin(end) * 33,
        114 - Math.cos(end) * 33,
      );
    }
    this.dc.setPenWidth(1);
    fitStat(this.dc, cx, 104, SAMPLE.stepGoalPercent, WHITE, 56, this.text);
  }

  bottomRow() {
    this.ink(LINE);
    this.line(71, 319, 345, 319);
    const values = [SAMPLE.steps, SAMPLE.calories, SAMPLE.battery];
    for (let field = 0; field < 3; field++) {
      const cx = 132 + field * 76;
      if (field > 0) {
        const divider = (cx + 132 + (field - 1) * 76) / 2;
        this.ink(LINE);
        this.line(divider, 326, divider, 367);
      }
      this.symbol(
        [STEPS, CALORIES, BATTERY][field],
        cx - (field === 2 ? 14 : 12),
        319,
        field === 2 ? WHITE : ORANGE,
      );
      if (field === 2) {
        this.ink(ORANGE);
        this.rectangle(
          cx - 9,
          328,
          Math.floor((SAMPLE.batteryLevel * 13) / 100),
          6,
        );
      }
      fitStat(
        this.dc,
        cx,
        343,
        values[field],
        WHITE,
        field === 1 ? 68 : 72,
        this.text,
      );
    }
  }

  draw() {
    const { dc, frame } = this;
    dc.setColor(BLACK, BLACK);
    dc.clear();
    this.ridge();
    this.ticks();
    this.ink(ORANGE);
    this.rectangle(206, 9, 4, 10);
    this.rectangle(206, 397, 4, 10);
    this.rectangle(9, 206, 10, 4);
    this.rectangle(397, 206, 10, 4);
    this.center(34, SMALL, 'S U M M I T', MUTED);
    this.symbol(HEART, 131 - 13, 68 - 12, RED);
    this.text(dc, 131, 88, STAT, SAMPLE.heartRate, WHITE, 'center');
    this.heartGraph(131);
    this.symbol(GOAL, 278 - 11, 54, ORANGE);
    this.goalRing(278);
    this.ink(LINE);
    this.line(208, 64, 208, 164);
    this.line(44, 170, 372, 170);

    // The clock always sits over the subdued ridge, hours white, minutes in
    // the accent; Summit drops the leading zero on a 12-hour watch.
    let hour = frame.hour;
    if (!frame.is24Hour) {
      hour %= 12;
      if (hour === 0) hour = 12;
    }
    const first = `${frame.is24Hour ? pad(hour) : hour}:`;
    const minutes = pad(frame.min);
    let slot = CLOCK;
    // Fall back only when a long 24-hour time would touch the date divider.
    if (dc.getTextWidth(slot, first + minutes) > 262) slot = AOD;
    const clockY = slot === CLOCK ? 184 : 199;
    const start = 164 - dc.getTextWidth(slot, first + minutes) / 2;
    this.text(dc, start, clockY, slot, first, WHITE, 'left');
    this.text(
      dc,
      start + dc.getTextWidth(slot, first),
      clockY,
      slot,
      minutes,
      ORANGE,
      'left',
    );
    this.ink(0x8b8f90);
    this.line(301, 190, 301, 252);
    this.text(dc, 334, 191, LABEL, weekday(frame), WHITE, 'center');
    this.text(dc, 334, 214, STAT, pad(frame.day), ORANGE, 'center');
    this.text(
      dc,
      334,
      244,
      SMALL,
      frame.is24Hour ? month(frame) : frame.hour < 12 ? 'AM' : 'PM',
      MUTED,
      'center',
    );
    if (this.standby || !frame.code) {
      // Standby never shows the code; the ridge's caption takes its place.
      this.center(299, SMALL, 'BETTER EVERY DAY', MUTED);
      this.ink(ORANGE);
      this.line(119, 305, 136, 305);
      this.line(280, 305, 297, 305);
    } else {
      drawKey(dc, 130, 297, 0xa3baa7);
      const left = remaining(frame);
      this.text(
        dc,
        175,
        291,
        CODE,
        otpText(frame),
        left <= 5 ? 0xf1c17b : WHITE,
        'left',
      );
      this.ink(LINE);
      this.rectangle(175, 313, 101, 2);
      this.ink(left <= 5 ? 0xf1c17b : ORANGE);
      this.rectangle(175, 313, Math.floor((101 * left) / 30), 2);
    }
    this.bottomRow();
  }
}

export function drawActive(
  dc: Dc,
  frame: Frame,
  mountain: CanvasImageSource | null = null,
) {
  new Composition(dc, frame, false, mountain).draw();
}

export function drawAlwaysOn(
  dc: Dc,
  frame: Frame,
  mountain: CanvasImageSource | null = null,
) {
  new Composition(dc, frame, true, mountain).draw();
}
