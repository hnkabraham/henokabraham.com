// Arcfield, from GalleryView.mc (GalleryStyle 3) and GalleryIcons.mc: two
// tick tracks with radial minute numbers, four progress arcs with their
// readings, four circular pods and cream outlined hands with an orange
// seconds hand. The Gallery collection has no authenticator.
import {
  LABEL_FONT,
  LABEL_REGULAR_FONT,
  TRANSPARENT,
  type Dc,
  type Frame,
  type SlotMetrics,
  pad,
  weekday,
} from './watch-face-dc';

// GalleryFonts.mc, by font index: R is Roboto Condensed Regular, B its
// Bold, N Garmin's Bionic Bold (Barlow stands in, in cells). A native
// font's size is 2400/2048 of its em, so its ascent is 1900/2400 of the
// size and its cap height 1456/2400; `tops` is how far GalleryView lifts
// each one, `caps` the height it lays out by and `coverage` its ink.
const FACES = 'RBRBRBRBRBRBRBRRRNNRBRRNNNBB';
const SIZES = [
  24, 24, 20, 20, 28, 28, 34, 34, 44, 44, 60, 60, 82, 82, 128, 164, 206, 120,
  180, 18, 18, 37, 100, 85, 60, 45, 128, 164,
];
const TOPS = [
  4, 4, 3, 3, 5, 5, 6, 6, 8, 8, 11, 11, 15, 15, 23, 30, 38, 27, 40, 3, 3, 6, 18,
  19, 13, 10, 23, 30,
];
const CAPS = [
  20, 20, 17, 17, 23, 23, 28, 28, 35, 35, 48, 48, 65, 65, 102, 130, 163, 61, 92,
  15, 15, 31, 80, 43, 31, 23, 102, 130,
];
const COVERAGE = [
  0.37, 0.52, 0.36, 0.53, 0.37, 0.52, 0.37, 0.51, 0.38, 0.53, 0.37, 0.53, 0.37,
  0.53, 0.37, 0.37, 0.37, 0.67, 0.67, 0.38, 0.53, 0.36, 0.37, 0.68, 0.66, 0.68,
  0.52, 0.53,
];

export const fonts: SlotMetrics[] = SIZES.map((size, index) => {
  const l: [number, number] = [(size * 444) / 2400, (size * 1456) / 2400];
  if (FACES[index] === 'N')
    return { n: [size * 0.2286, size * 0.507, size * 0.407, size * 0.164], l };
  return FACES[index] === 'R' ? { n: null, l, regular: true } : { n: null, l };
});

const WHITE = 0xf4f2ea;
const ACCENT = 0xff6715;
const RED = 0xff621c;
const POD = 0x262722;
const HAND_CORE = 0x17191a;

// Arcfield gauges: arc start (clock degrees), metric, label radius, label
// angle, clockwise, label width, icon radius, icon angle.
const GAUGES: [
  number,
  number,
  number,
  number,
  boolean,
  number,
  number,
  number,
][] = [
  [0, 3, 158, 13, true, 53, 164, 27],
  [90, 1, 173, 280, false, 48, 165, 296],
  [180, 2, 173, 193, false, 42, 165, 207],
  [270, 0, 158, 103, true, 47, 164, 117],
];

// GalleryMetrics.fixture() for Arcfield: battery, steps, heart rate, Body
// Battery, then the temperature (°C) and the step goal. The temperature shows
// in Fahrenheit, as a watch in US units shows it and as Nightwatch's does.
// The pods keep their schema defaults: temperature, Health and Altitude
// shortcuts, the date.
const RAW: Record<number, number> = { 0: 58, 1: 4186, 2: 92, 3: 63, 9: 18 };
const GOAL = 10000;
const PODS = [9, 17, 18, 16];

function grouped(value: number) {
  const digits = String(Math.trunc(value));
  let result = '';
  for (let index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 === 0) result += ',';
    result += digits[index];
  }
  return result;
}

function metricValue(index: number) {
  const value = RAW[index];
  if (index === 0) return `${Math.round(value)}%`;
  if (index === 1) return grouped(value);
  if (index === 9) return `${Math.round(value * 1.8 + 32)}°`;
  return String(Math.trunc(value));
}

function ratio(index: number) {
  const value = RAW[index];
  if (index === 0 || index === 3) return value / 100;
  if (index === 1) return value > GOAL ? 1 : value / GOAL;
  if (index === 2) return value > 200 ? 1 : value / 200;
  return null;
}

const shade = (color: number, factor: number) =>
  (Math.trunc(((color >> 16) & 255) * factor) << 16) |
  (Math.trunc(((color >> 8) & 255) * factor) << 8) |
  Math.trunc((color & 255) * factor);

const mix = (first: number, second: number, portion: number) =>
  (Math.trunc(
    ((first >> 16) & 255) * (1 - portion) + ((second >> 16) & 255) * portion,
  ) <<
    16) |
  (Math.trunc(
    ((first >> 8) & 255) * (1 - portion) + ((second >> 8) & 255) * portion,
  ) <<
    8) |
  Math.trunc((first & 255) * (1 - portion) + (second & 255) * portion);

const luma = (color: number) =>
  (0.3 * ((color >> 16) & 255) +
    0.6 * ((color >> 8) & 255) +
    0.1 * (color & 255)) /
  255;

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

// GalleryView's state and drawing helpers. On the always-on screen it draws
// twice, as the watch does: once only measuring the light each layer would
// emit, then for real at gains that keep it within the display's budget.
class Arcfield {
  private measure = false;
  private ink = 0;
  private decorInk = 0;
  private layer = 0;
  private gain = 1;
  private decorGain = 1;
  private dx = 0;
  private dy = 0;
  private paint = '#ffffff';

  constructor(
    private readonly dc: Dc,
    private readonly frame: Frame,
    private readonly low: boolean,
  ) {}

  render() {
    const minute = Math.floor(this.frame.epoch / 60);
    this.dx = this.low ? ((minute % 3) - 1) * 2 : 0;
    this.dy = this.low ? ((Math.floor(minute / 3) % 3) - 1) * 2 : 0;
    if (this.low) {
      this.measure = true;
      this.layer = 0;
      this.arcs();
      this.measure = false;
      [this.gain, this.decorGain] = layerGains(
        this.ink - this.decorInk,
        this.decorInk,
      );
    }
    this.layer = 0;
    this.arcs();
  }

  // Always-on text keeps a readable minimum luminance; black is never lifted.
  private textColor(color: number) {
    if (!this.low || color === 0) return color;
    const level = luma(color);
    return level < 0.5
      ? mix(color, 0xffffff, (0.5 - level) / (1 - level))
      : color;
  }

  private use(color: number, area: number) {
    if (this.measure) {
      const ink = area * luma(color);
      this.ink += ink;
      if (this.layer === 1) this.decorInk += ink;
      return;
    }
    const shaded = shade(color, this.layer === 1 ? this.decorGain : this.gain);
    this.paint = css(shaded);
    this.dc.setColor(shaded, TRANSPARENT);
  }

  private width(value: string, font: number) {
    return this.dc.getTextWidth(font, value);
  }

  private textInk(width: number, font: number) {
    return width * CAPS[font] * COVERAGE[font];
  }

  private txt(
    center: number,
    top: number,
    font: number,
    value: string,
    color: number,
  ) {
    const width = this.width(value, font);
    this.use(this.textColor(color), this.textInk(width, font));
    if (!this.measure)
      this.dc.drawText(
        Math.round(center) + this.dx,
        Math.round(top) + this.dy - TOPS[font],
        font,
        value,
        'center',
      );
  }

  private fitFont(value: string, width: number, choices: number[]) {
    for (const font of choices)
      if (this.width(value, font) <= width) return font;
    return choices[choices.length - 1];
  }

  private fit(
    center: number,
    top: number,
    value: string,
    color: number,
    width: number,
    choices: number[],
  ) {
    const font = this.fitFont(value, width, choices);
    if (this.width(value, font) > width) {
      while (value.length > 0 && this.width(value + '...', font) > width)
        value = value.slice(0, -1);
      value += '...';
    }
    this.txt(center, top, font, value, color);
  }

  private shorten(value: string, font: number, maximum: number) {
    if (this.width(value, font) <= maximum) return value;
    while (value.length > 0 && this.width(value + '...', font) > maximum)
      value = value.slice(0, -1);
    return value + '...';
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    width: number,
  ) {
    if (this.measure) {
      this.use(color, (Math.hypot(x2 - x1, y2 - y1) + width) * (width + 0.8));
      return;
    }
    this.use(color, 0);
    this.dc.setPenWidth(width);
    this.dc.drawLine(x1 + this.dx, y1 + this.dy, x2 + this.dx, y2 + this.dy);
    this.dc.setPenWidth(1);
  }

  circle(x: number, y: number, radius: number, color: number, filled: boolean) {
    this.use(
      color,
      filled
        ? Math.PI * (radius + 0.5) * (radius + 0.5)
        : Math.PI * 2 * (radius + 0.5) * 1.8,
    );
    if (this.measure) return;
    if (filled) this.dc.fillCircle(x + this.dx, y + this.dy, radius);
    else this.dc.drawCircle(x + this.dx, y + this.dy, radius);
  }

  box(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: number,
  ) {
    this.use(color, (width + 1) * (height + 1));
    if (!this.measure)
      this.dc.fillRoundedRectangle(
        x + this.dx,
        y + this.dy,
        width,
        height,
        radius,
      );
  }

  poly(coordinates: number[], color: number) {
    let area = 0;
    const points: [number, number][] = [];
    for (let index = 0; index < coordinates.length; index += 2) {
      const next = (index + 2) % coordinates.length;
      if (this.measure)
        area +=
          coordinates[index] * coordinates[next + 1] -
          coordinates[next] * coordinates[index + 1];
      else
        points.push([
          coordinates[index] + this.dx,
          coordinates[index + 1] + this.dy,
        ]);
    }
    this.use(color, Math.abs(area) * 0.575 + coordinates.length);
    if (!this.measure) this.dc.fillPolygon(points);
  }

  // Clock degrees, clockwise from twelve, turned into Garmin's whole degrees
  // counter-clockwise from three; equal ends draw the whole ring.
  arc(
    x: number,
    y: number,
    radius: number,
    start: number,
    finish: number,
    color: number,
    width: number,
    rounded: boolean,
  ) {
    if (finish - start < 1) return;
    this.use(
      color,
      ((radius * (finish - start) * Math.PI) / 180) * (width + 0.8),
    );
    if (!this.measure) {
      const from = Math.trunc(1170 - start) % 360;
      const to = Math.trunc(1170 - finish) % 360;
      this.dc.setPenWidth(width);
      this.dc.ctx.lineCap = 'butt';
      if (from === to) this.dc.drawCircle(x + this.dx, y + this.dy, radius);
      else this.dc.drawArc(x + this.dx, y + this.dy, radius, false, from, to);
      this.dc.setPenWidth(1);
    }
    if (rounded) {
      const first = (start * Math.PI) / 180;
      const last = (finish * Math.PI) / 180;
      this.circle(
        x + Math.sin(first) * radius,
        y - Math.cos(first) * radius,
        width / 2,
        color,
        true,
      );
      this.circle(
        x + Math.sin(last) * radius,
        y - Math.cos(last) * radius,
        width / 2,
        color,
        true,
      );
    }
  }

  private progress(
    radius: number,
    start: number,
    finish: number,
    fraction: number | null,
    color: number,
    width: number,
  ) {
    this.arc(208, 208, radius, start, finish, shade(color, 0.28), width, true);
    if (fraction !== null && fraction > 0)
      this.arc(
        208,
        208,
        radius,
        start,
        start + (finish - start) * fraction,
        color,
        width,
        true,
      );
  }

  // Dc.drawRadialText: each glyph's baseline sits on the circle, centred on
  // its share of the text's width. Clockwise text runs over the top with its
  // glyphs standing outward; counter-clockwise text runs under, standing in.
  private radial(
    radius: number,
    angle: number,
    font: number,
    value: string,
    color: number,
    clockwise: boolean,
    maximum: number,
  ) {
    value = this.shorten(value === '--' ? '---' : value, font, maximum);
    color = this.textColor(color);
    const total = this.width(value, font);
    this.use(color, this.textInk(total, font) * 1.05 + 4);
    if (this.measure) return;
    const glyphs = value
      .split('')
      .map((character) => this.width(character, font));
    const stretch =
      total /
      Math.max(
        1,
        glyphs.reduce((sum, width) => sum + width, 0),
      );
    const { ctx } = this.dc;
    const { l, regular } = fonts[font];
    const face = `${l[1] / 0.7109375}px "${regular ? LABEL_REGULAR_FONT : LABEL_FONT}"`;
    const x = 208 + this.dx;
    const y = 208 + this.dy;
    let advance = -total / 2;
    value.split('').forEach((character, index) => {
      const width = glyphs[index] * stretch;
      const degrees =
        angle +
        ((clockwise ? -1 : 1) * (((advance + width / 2) / radius) * 180)) /
          Math.PI;
      const radians = (degrees * Math.PI) / 180;
      ctx.save();
      ctx.translate(
        x + Math.cos(radians) * radius,
        y - Math.sin(radians) * radius,
      );
      ctx.rotate((((clockwise ? 90 : 270) - degrees) * Math.PI) / 180);
      ctx.font = face;
      ctx.fillStyle = this.paint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(character, 0, 0);
      ctx.restore();
      advance += width;
    });
  }

  private ticks(radius: number, count: number, length: number, color: number) {
    for (let index = 0; index < count; index++) {
      const angle = (index * 2 * Math.PI) / count;
      const long = index % (count / 12) === 0;
      if (radius > 185 && long) continue;
      // Arcfield's cardinal dots and 12 o'clock marker replace their long ticks.
      if (radius < 150 && index % (count / 4) === 0) continue;
      if (this.low && !long && index % 2 === 1) continue;
      const inside = radius - (long ? length : length * 0.56);
      const firstX = 208 + Math.sin(angle) * inside;
      const firstY = 208 - Math.cos(angle) * inside;
      const lastX = 208 + Math.sin(angle) * radius;
      const lastY = 208 - Math.cos(angle) * radius;
      this.line(firstX, firstY, lastX, lastY, color, 3);
      this.circle(firstX, firstY, 1.5, color, true);
      this.circle(lastX, lastY, 1.5, color, true);
    }
  }

  private hand(
    angle: number,
    length: number,
    width: number,
    color: number,
    outlined: boolean,
  ) {
    const radians = (angle * Math.PI) / 180;
    const endX = 208 + Math.sin(radians) * length;
    const endY = 208 - Math.cos(radians) * length;
    this.line(208, 208, endX, endY, color, width);
    this.circle(endX, endY, width / 2, color, true);
    if (outlined) {
      this.line(208, 208, endX, endY, HAND_CORE, width - 8);
      this.circle(endX, endY, (width - 8) / 2, HAND_CORE, true);
    }
  }

  // hands(1, 114, 149) with the reference hand style: 14-pixel outlined
  // hands awake, thin solid ones always-on.
  private hands() {
    const { hour, min, sec } = this.frame;
    const width = this.low ? 4 : 14;
    this.hand((hour % 12) * 30 + min * 0.5, 114, width, WHITE, !this.low);
    this.hand(min * 6, 149, this.low ? 2 : 14, WHITE, !this.low);
    if (this.low) {
      this.circle(208, 208, 3, RED, true);
      this.circle(208, 208, 1, 0x101010, true);
      return;
    }
    const radians = (sec * Math.PI) / 30;
    this.line(
      208 - Math.sin(radians) * 27,
      208 + Math.cos(radians) * 27,
      208 + Math.sin(radians) * 190,
      208 - Math.cos(radians) * 190,
      RED,
      2,
    );
    this.circle(208, 208, 18, WHITE, true);
    this.circle(208, 208, 9, RED, true);
  }

  // GalleryIcons: the path and shape helpers, and the symbols Arcfield's
  // defaults reach (battery, steps, heart rate, Body Battery, temperature,
  // Health, Altitude). Always-on icons are on by default, so every one draws.
  private path(
    x: number,
    y: number,
    size: number,
    points: number[],
    color: number,
    width: number,
  ) {
    for (let index = 2; index < points.length; index += 2)
      this.line(
        x + points[index - 2] * size,
        y + points[index - 1] * size,
        x + points[index] * size,
        y + points[index + 1] * size,
        color,
        width,
      );
  }

  private shape(
    x: number,
    y: number,
    size: number,
    points: number[],
    color: number,
  ) {
    this.poly(
      points.map((value, index) => (index % 2 === 0 ? x : y) + value * size),
      color,
    );
  }

  private ring(
    x: number,
    y: number,
    radius: number,
    color: number,
    width: number,
  ) {
    this.arc(x, y, radius, 0, 360, color, width, false);
  }

  private icon(
    choice: number,
    x: number,
    y: number,
    size: number,
    color: number,
  ) {
    if (choice === 0) {
      // GalleryIcons.reference: a filled cell for Arcfield's battery.
      this.box(
        x - size * 0.45,
        y - size * 0.69,
        size * 0.9,
        size * 1.59,
        size * 0.12,
        color,
      );
      this.box(
        x - size * 0.2,
        y - size * 0.92,
        size * 0.4,
        size * 0.27,
        0,
        color,
      );
    } else if (choice === 1) {
      this.shape(
        x,
        y,
        size,
        [
          -0.9, -0.35, -0.5, -0.77, -0.22, -0.64, -0.25, -0.33, 0.16, 0.29,
          0.15, 0.66, -0.13, 0.8,
        ],
        color,
      );
      this.shape(
        x,
        y,
        size,
        [
          -0.24, -0.9, 0.12, -0.96, 0.42, -0.7, 0.32, -0.39, 0.87, 0.4, 0.88,
          0.69, 0.61, 0.92, 0.38, 0.76,
        ],
        color,
      );
    } else if (choice === 2) {
      this.shape(
        x,
        y,
        size,
        [
          0, -0.45, -0.2, -0.73, -0.5, -0.86, -0.78, -0.76, -0.94, -0.52, -0.94,
          -0.23, -0.8, 0.08, -0.54, 0.37, 0, 0.91, 0.54, 0.37, 0.8, 0.08, 0.94,
          -0.23, 0.94, -0.52, 0.78, -0.76, 0.5, -0.86, 0.2, -0.73,
        ],
        color,
      );
    } else if (choice === 3) {
      this.shape(
        x,
        y,
        size,
        [
          0.2, -0.95, -0.65, 0.13, -0.08, 0.13, -0.2, 0.95, 0.65, -0.13, 0.08,
          -0.13,
        ],
        color,
      );
    } else if (choice === 9) {
      // Arcfield's own temperature figure: a thermometer beside a walker.
      this.circle(x - size * 0.15, y - size * 0.73, size * 0.18, color, true);
      this.path(x, y, size, [-0.83, -0.29, 0.37, -0.29], color, 2);
      this.path(x, y, size, [-0.17, -0.24, -0.23, 0.22, -0.56, 0.88], color, 2);
      this.path(x, y, size, [-0.23, 0.22, 0.04, 0.88], color, 2);
      this.path(x, y, size, [0.58, -0.13, 0.58, 0.5], color, 2);
      this.ring(x + size * 0.58, y + size * 0.67, size * 0.23, color, 1);
    } else if (choice === 17) {
      this.circle(x, y - size * 0.49, size * 0.33, color, true);
      this.shape(
        x,
        y,
        size,
        [
          -0.81, 0.64, -0.8, 0.47, -0.73, 0.28, -0.62, 0.14, -0.46, 0.04, -0.25,
          -0.02, 0.25, -0.02, 0.46, 0.04, 0.62, 0.14, 0.73, 0.28, 0.8, 0.47,
          0.81, 0.64, 0.75, 0.75, 0.57, 0.87, 0.29, 0.94, 0, 0.96, -0.29, 0.94,
          -0.57, 0.87, -0.75, 0.75,
        ],
        color,
      );
    } else if (choice === 18) {
      // A folded map under a magnifier.
      this.shape(
        x,
        y,
        size,
        [-0.94, 0.83, -0.94, -0.67, -0.35, -0.94, -0.35, 0.61],
        color,
      );
      this.shape(
        x,
        y,
        size,
        [-0.22, -0.91, 0.35, -0.65, 0.35, -0.06, -0.22, -0.27],
        color,
      );
      this.shape(
        x,
        y,
        size,
        [0.45, -0.65, 0.94, -0.94, 0.94, 0.04, 0.72, -0.14, 0.45, -0.17],
        color,
      );
      this.ring(x + size * 0.26, y + size * 0.35, size * 0.4, color, 2);
      this.path(x, y, size, [0.56, 0.65, 0.91, 0.99], color, 3);
    }
  }

  private polarIcon(
    choice: number,
    radius: number,
    angle: number,
    size: number,
    color: number,
  ) {
    const radians = (angle * Math.PI) / 180;
    this.icon(
      choice,
      208 + Math.cos(radians) * radius,
      208 - Math.sin(radians) * radius,
      size,
      color,
    );
  }

  private pod(slot: number, x: number, y: number, color: number) {
    const choice = PODS[slot];
    if (!this.low) {
      this.layer = 1;
      this.circle(x, y, 45, POD, true);
      this.layer = 0;
    }
    if (choice === 16) {
      this.fit(x, y - 21, weekday(this.frame), color, 81, [5, 3, 20]);
      this.fit(x, y + 3, pad(this.frame.day), color, 81, [9, 7, 5]);
      return;
    }
    if (choice === 17 || choice === 18) {
      this.icon(choice, x, y, 45 * 0.43, color);
      return;
    }
    // Always-on icons stay on by default, so the reading sits under its icon.
    this.icon(choice, x, y - 18, 13, color);
    this.fit(x, y + 7, metricValue(choice), WHITE, 45 * 1.82, [7, 5, 3, 20]);
  }

  private arcs() {
    this.layer = 1;
    this.ticks(197, 60, 10, 0x595952);
    this.ticks(144, 60, 7, 0xa2a19a);
    for (let cardinal = 1; cardinal < 4; cardinal++) {
      const angle = (cardinal * Math.PI) / 2;
      this.circle(
        208 + Math.sin(angle) * 144,
        208 - Math.cos(angle) * 144,
        5,
        0xa2a19a,
        true,
      );
    }
    for (let index = 0; index < 12; index++) {
      const degrees = index * 30;
      const clockwise = degrees < 90 || degrees > 270;
      this.radial(
        clockwise ? 190 : 204,
        90 - degrees,
        3,
        pad(index * 5),
        WHITE,
        clockwise,
        30,
      );
    }
    for (const [start, metric] of GAUGES)
      this.progress(
        169,
        start,
        start + 56,
        ratio(metric),
        WHITE,
        this.low ? 2 : 10,
      );
    this.poly([201, 59, 215, 59, 208, 69], ACCENT);
    this.layer = 0;
    for (const [
      ,
      metric,
      radius,
      angle,
      clockwise,
      width,
      iconRadius,
      iconAngle,
    ] of GAUGES) {
      this.radial(
        radius,
        angle,
        2,
        metricValue(metric),
        0xb8b8af,
        clockwise,
        width,
      );
      this.polarIcon(
        metric,
        iconRadius,
        iconAngle,
        6,
        metric === 1 && !this.low ? 0x23d15f : WHITE,
      );
    }
    this.pod(0, 208, 128, WHITE);
    this.pod(1, 128, 208, WHITE);
    this.pod(2, 288, 208, WHITE);
    this.pod(3, 208, 288, 0xa1a19a);
    this.hands();
  }
}

// Time, text and icons keep the selected (maximum) brightness; rings, ticks
// and fills dim first to keep the estimated light within 12,900
// full-white pixels.
function layerGains(content: number, decor: number) {
  const limit = 12900;
  const contentGain = content > limit ? limit / content : 1;
  const remaining = limit - content * contentGain;
  let decorGain = contentGain;
  if (decor * decorGain > remaining)
    decorGain = remaining > 0 ? remaining / decor : 0;
  return [contentGain, decorGain];
}

export function drawActive(dc: Dc, frame: Frame) {
  new Arcfield(dc, frame, false).render();
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  new Arcfield(dc, frame, true).render();
}
