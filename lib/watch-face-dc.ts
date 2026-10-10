// A small stand-in for Garmin's Graphics.Dc, so the Bezel Auth faces can be
// ported line for line from their Monkey C views and drawn on a canvas in the
// watch's own 416-pixel space. Only the calls those views make are here.
//
// Text follows the faces' 1.1.0 typography (AuthNumerals.mc): numerals in
// fixed-width cells of the device's bold numeral font, everything else in
// Roboto Condensed Bold. The numeral font is Garmin's and stays on the watch,
// so Barlow Bold stands in, scaled to the same cap height and set in the same
// cells, so every line keeps its width; the label font is the watch's own.
// Per face and per font slot, `n` is the numerals' cap top (from the drawText
// y), cap height, cell width and colon width, and `l` the labels' cap top and
// cap height, as measured on the device fonts (each project's
// provenance.json).

export type SlotMetrics = {
  n: [capTop: number, cap: number, cell: number, colon: number] | null;
  l: [capTop: number, cap: number];
};

// Font slots, in the order DuoFaceView loads them.
export const CLOCK = 0;
export const CODE = 1;
export const LABEL = 2;
export const SMALL = 3;
export const STAT = 4;
export const AOD = 5;
export const AOD_DATE = 6;

export const TRANSPARENT = -1;
export const BLACK = 0x000000;
export const WHITE = 0xffffff;

export type Justify = 'left' | 'center' | 'right';

export const NUMERAL_FONT = 'Bezel Numerals';
export const LABEL_FONT = 'Bezel Labels';
// Cap heights as a fraction of the em: Barlow's 700/1000, Roboto Condensed's
// 1456/2048.
const NUMERAL_CAP = 0.7;
const LABEL_CAP = 0.7109375;

const NUMERIC = /^[0-9: .,%+\-/°]*$/;
const HAS_DIGIT = /[0-9]/;

function css(color: number) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export class Dc {
  readonly ctx: CanvasRenderingContext2D;
  readonly fonts: SlotMetrics[];
  private ink = WHITE;
  private paper = BLACK;
  private pen = 1;

  constructor(ctx: CanvasRenderingContext2D, fonts: SlotMetrics[]) {
    this.ctx = ctx;
    this.fonts = fonts;
  }

  setColor(foreground: number, background: number) {
    if (foreground !== TRANSPARENT) this.ink = foreground;
    this.paper = background;
  }

  setPenWidth(width: number) {
    this.pen = width;
  }

  clear() {
    this.ctx.fillStyle = css(this.paper === TRANSPARENT ? BLACK : this.paper);
    this.ctx.fillRect(0, 0, 416, 416);
  }

  // Garmin's coordinates name pixels, so strokes and circles are drawn
  // through pixel centres; filled rectangles cover whole pixels. Its wide
  // anti-aliased lines end round, which is what joins the segmented arcs.
  drawLine(x1: number, y1: number, x2: number, y2: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.lineCap = 'round';
    ctx.lineWidth = this.pen;
    ctx.strokeStyle = css(this.ink);
    ctx.stroke();
  }

  drawCircle(x: number, y: number, radius: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
    ctx.lineWidth = this.pen;
    ctx.strokeStyle = css(this.ink);
    ctx.stroke();
  }

  fillCircle(x: number, y: number, radius: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
    ctx.fillStyle = css(this.ink);
    ctx.fill();
  }

  // Degrees counter-clockwise from three o'clock, as Graphics.drawArc takes
  // them; the canvas measures clockwise.
  drawArc(
    x: number,
    y: number,
    radius: number,
    counterClockwise: boolean,
    start: number,
    end: number,
  ) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(
      x + 0.5,
      y + 0.5,
      radius,
      (-start * Math.PI) / 180,
      (-end * Math.PI) / 180,
      counterClockwise,
    );
    ctx.lineWidth = this.pen;
    ctx.strokeStyle = css(this.ink);
    ctx.stroke();
  }

  fillRectangle(x: number, y: number, width: number, height: number) {
    this.ctx.fillStyle = css(this.ink);
    this.ctx.fillRect(x, y, width, height);
  }

  fillRoundedRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    this.roundedPath(x, y, width, height, radius);
    this.ctx.fillStyle = css(this.ink);
    this.ctx.fill();
  }

  drawRoundedRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const inset = this.pen / 2;
    this.roundedPath(
      x + inset,
      y + inset,
      width - this.pen,
      height - this.pen,
      Math.max(0, radius - inset),
    );
    this.ctx.lineWidth = this.pen;
    this.ctx.strokeStyle = css(this.ink);
    this.ctx.stroke();
  }

  fillPolygon(points: [number, number][]) {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([x, y], index) =>
      index ? ctx.lineTo(x + 0.5, y + 0.5) : ctx.moveTo(x + 0.5, y + 0.5),
    );
    ctx.closePath();
    ctx.fillStyle = css(this.ink);
    ctx.fill();
  }

  private roundedPath(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const { ctx } = this;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  private numeralFont(slot: number) {
    const metrics = this.fonts[slot].n;
    return metrics ? `${metrics[1] / NUMERAL_CAP}px "${NUMERAL_FONT}"` : '';
  }

  private labelFont(slot: number) {
    return `${this.fonts[slot].l[1] / LABEL_CAP}px "${LABEL_FONT}"`;
  }

  private numeric(slot: number, value: string) {
    return (
      this.fonts[slot].n !== null &&
      NUMERIC.test(value) &&
      HAS_DIGIT.test(value)
    );
  }

  // Each character's advance in a numeric string: digits share one cell and
  // the colon keeps the device font's width; a comma or space comes from the
  // label font, other marks from the numerals.
  private advance(slot: number, character: string) {
    const metrics = this.fonts[slot].n!;
    if (character >= '0' && character <= '9') return metrics[2];
    if (character === ':') return metrics[3];
    this.ctx.font =
      character === ',' || character === ' '
        ? this.labelFont(slot)
        : this.numeralFont(slot);
    return this.ctx.measureText(character).width;
  }

  getTextWidth(slot: number, value: string) {
    if (this.numeric(slot, value)) {
      let width = 0;
      for (const character of value) width += this.advance(slot, character);
      return width;
    }
    this.ctx.font = this.labelFont(slot);
    return this.ctx.measureText(value).width;
  }

  // Garmin's drawText y is the top of the text cell.
  drawText(
    x: number,
    y: number,
    slot: number,
    value: string,
    justify: Justify,
  ) {
    const { ctx } = this;
    ctx.fillStyle = css(this.ink);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const width = this.getTextWidth(slot, value);
    let cursor =
      justify === 'center'
        ? x - width / 2
        : justify === 'right'
          ? x - width
          : x;
    if (!this.numeric(slot, value)) {
      const [capTop, cap] = this.fonts[slot].l;
      ctx.font = this.labelFont(slot);
      ctx.fillText(value, cursor, y + capTop + cap);
      return;
    }
    const [capTop, cap] = this.fonts[slot].n!;
    const baseline = y + capTop + cap;
    for (const character of value) {
      const cell = this.advance(slot, character);
      const centred =
        (character >= '0' && character <= '9') || character === ':';
      if (centred) ctx.font = this.numeralFont(slot);
      const inset = centred ? (cell - ctx.measureText(character).width) / 2 : 0;
      ctx.fillText(character, cursor + inset, baseline);
      cursor += cell;
    }
  }
}

// What the faces show besides the time: the store images' fixture, the same
// numbers the faces' preview harness substitutes for the watch's sensors.
export type Frame = {
  hour: number;
  min: number;
  sec: number;
  // Seconds since the epoch, for the always-on drift and the code's window.
  epoch: number;
  day: number;
  weekday: number;
  month: number;
  is24Hour: boolean;
  code: string | null;
};

export const SAMPLE = {
  steps: '8,420',
  battery: '64%',
  batteryLevel: 64,
  calories: '847',
  caloriesValue: 847,
  floors: '12',
  stepGoalPercent: '84%',
  stepProgress: 0.84,
  heartRate: '80',
  heartRateValue: 80,
};

// Thirty minutes of wrist readings around 80 bpm, one a minute, rising and
// falling as the simulator's sensor history does in the store images.
export const HEART_HISTORY = Array.from({ length: 30 }, (_, index) =>
  Math.round(80 + 8 * Math.sin((index * 2 * Math.PI) / 7)),
);

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

export const weekday = (frame: Frame) => WEEKDAYS[frame.weekday];
export const month = (frame: Frame) => MONTHS[frame.month];
export const pad = (value: number) => String(value).padStart(2, '0');

// DuoFaceView's shared helpers.
export function text(
  dc: Dc,
  x: number,
  y: number,
  slot: number,
  value: string,
  color: number,
  justify: Justify,
) {
  dc.setColor(color, TRANSPARENT);
  dc.drawText(x, y, slot, value, justify);
}

export function center(
  dc: Dc,
  y: number,
  slot: number,
  value: string,
  color: number,
) {
  text(dc, 208, y, slot, value, color, 'center');
}

export function clockText(frame: Frame) {
  let hour = frame.hour;
  if (!frame.is24Hour) {
    hour %= 12;
    if (hour === 0) hour = 12;
  }
  return `${pad(hour)}:${pad(frame.min)}`;
}

export function dateText(frame: Frame) {
  return `${weekday(frame)} / ${month(frame)} ${pad(frame.day)}`;
}

export function otpText(frame: Frame) {
  return frame.code ? `${frame.code.slice(0, 3)} ${frame.code.slice(3)}` : '';
}

export const remaining = (frame: Frame) => 30 - (frame.epoch % 30);

export function fitStat(
  dc: Dc,
  x: number,
  y: number,
  value: string,
  color: number,
  width: number,
  draw = text,
) {
  let slot = STAT;
  if (dc.getTextWidth(slot, value) > width) slot = AOD_DATE;
  if (dc.getTextWidth(slot, value) > width) slot = SMALL;
  draw(dc, x, y, slot, value, color, 'center');
}

// The authenticator's key symbol, drawn by each face beside its code.
export function drawKey(dc: Dc, x: number, y: number, color: number) {
  dc.setColor(color, TRANSPARENT);
  dc.setPenWidth(2);
  dc.drawCircle(x + 5, y + 6, 4);
  dc.drawLine(x + 9, y + 6, x + 25, y + 6);
  dc.drawLine(x + 20, y + 6, x + 20, y + 10);
  dc.drawLine(x + 25, y + 6, x + 25, y + 10);
  dc.setPenWidth(1);
}

export function drawTicksAt(
  dc: Dc,
  cx: number,
  cy: number,
  inner: number,
  majorInner: number,
  outer: number,
  minorColor: number,
  majorColor: number,
) {
  for (let i = 0; i < 60; i++) {
    const angle = (i * Math.PI) / 30;
    const major = i % 5 === 0;
    const radius = major ? majorInner : inner;
    dc.setColor(major ? majorColor : minorColor, TRANSPARENT);
    dc.setPenWidth(major ? 2 : 1);
    dc.drawLine(
      cx + Math.sin(angle) * radius,
      cy - Math.cos(angle) * radius,
      cx + Math.sin(angle) * outer,
      cy - Math.cos(angle) * outer,
    );
  }
  dc.setPenWidth(1);
}

export function drawTicks(
  dc: Dc,
  inner: number,
  majorInner: number,
  outer: number,
  minorColor: number,
  majorColor: number,
) {
  drawTicksAt(dc, 208, 208, inner, majorInner, outer, minorColor, majorColor);
}

// The always-on screen moves three pixels a minute through a 3 × 3 grid, so
// no pixel stays lit in one place.
export function drift(frame: Frame) {
  const minute = Math.floor(frame.epoch / 60);
  return {
    dx: ((minute % 3) - 1) * 3,
    dy: ((Math.floor(minute / 3) % 3) - 1) * 3,
  };
}
