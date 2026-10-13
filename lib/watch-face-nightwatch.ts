// Nightwatch, from ExplorerView.mc (FaceVariant 2): a star chart and a
// crescent round a split digital clock, with the weather below. Its settings
// are the defaults (violet accent, detailed artwork, full forecast, battery),
// and its 2FA row is off, as it is out of the box.
import {
  type Dc,
  type Frame,
  type Justify,
  type SlotMetrics,
  TRANSPARENT,
  weekday,
  pad,
} from './watch-face-dc';

// Font slots, in the order ExplorerView loads them, as the native fonts
// NativeFonts.mc picks: Bionic Bold 164, 164, 56 and 84 (Barlow in its cells
// here), Roboto Condensed Bold 32, 27, 23 and 27. The view lifts each
// string by its font's cell top, so the cap tops land on the y it names.
const CLOCK = 0;
const AOD = 1;
const LABEL = 3;
const SMALL = 4;
const STAT = 5;
const TOPS = [37, 37, 6, 5, 4, 13, 5, 19];
export const fonts: SlotMetrics[] = [
  { n: [37, 83, 66.7, 26.7], l: [37, 100] },
  { n: [37, 83, 66.7, 26.7], l: [37, 100] },
  { n: null, l: [6, 19] },
  { n: null, l: [5, 16] },
  { n: null, l: [4, 14] },
  { n: [13, 28.4, 22.8, 9.2], l: [13, 34] },
  { n: null, l: [5, 16] },
  { n: [19, 42.6, 34.2, 13.8], l: [19, 51] },
];

// Each character's ink in each native font, for the always-on light budget
// (NativeFonts.ink); a character not listed counts 1000.
const INK_CHARS = ' %+,-./0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZ°';
const INK = [
  [
    4,
    3208,
    1389,
    1023,
    421,
    372,
    1373,
    3327,
    1720,
    2972,
    2998,
    2808,
    3250,
    3324,
    2231,
    3549,
    3355,
    739,
    ...Array<number>(27).fill(1023),
    430,
  ],
  [
    4, 140, 88, 31, 26, 20, 67, 162, 93, 140, 141, 141, 146, 151, 110, 169, 148,
    36, 97, 165, 199, 152, 181, 157, 131, 180, 187, 86, 112, 182, 109, 267, 208,
    180, 161, 194, 190, 162, 119, 175, 156, 254, 169, 129, 147, 40,
  ],
  [
    4, 102, 64, 23, 20, 16, 49, 117, 68, 102, 102, 102, 106, 109, 80, 122, 107,
    27, 70, 119, 143, 110, 130, 113, 94, 131, 134, 62, 81, 131, 79, 192, 149,
    130, 116, 140, 136, 117, 88, 126, 113, 182, 122, 94, 107, 29,
  ],
  [
    4, 75, 48, 18, 16, 13, 37, 87, 51, 76, 76, 75, 78, 81, 60, 90, 80, 21, 53,
    89, 107, 82, 98, 85, 72, 97, 100, 48, 62, 98, 61, 141, 111, 98, 87, 105,
    103, 87, 65, 95, 84, 134, 90, 70, 79, 22,
  ],
  [
    4,
    378,
    166,
    123,
    53,
    47,
    164,
    392,
    205,
    350,
    353,
    331,
    383,
    391,
    264,
    417,
    395,
    90,
    ...Array<number>(27).fill(123),
    54,
  ],
  [
    4,
    846,
    368,
    272,
    114,
    101,
    364,
    878,
    455,
    784,
    791,
    741,
    858,
    877,
    590,
    936,
    885,
    197,
    ...Array<number>(27).fill(272),
    116,
  ],
];
const INK_OF_SLOT = [0, 0, 1, 2, 3, 4, 2, 5];

const ACCENT = 0xa3acff;
const WHITE = 0xf7faff;
const SUN = 0xffd552;
const WATER = 0x7ed4f5;

// The store fixture: a 64% battery, and the weather in the watch's
// Fahrenheit, 16.7 °C now, 20 and 7.2 for the day, a 20% chance of rain,
// partly sunny.
const BATTERY = 64;
const WEATHER = { temp: '62°', high: '68°', low: '45°', rain: '20%' };

const STARS = [
  [92, 91],
  [116, 72],
  [130, 111],
  [155, 95],
  [159, 54],
  [259, 58],
  [280, 92],
  [311, 77],
  [330, 116],
  [307, 144],
  [65, 265],
  [82, 303],
  [113, 322],
  [315, 278],
  [301, 311],
  [327, 331],
];
const LINKS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [7, 8],
  [8, 9],
  [10, 11],
  [11, 12],
  [13, 14],
  [14, 15],
];

const channel = (color: number, shift: number, factor: number) =>
  Math.trunc(((color >> shift) & 255) * factor);
const shade = (color: number, factor: number) =>
  (channel(color, 16, factor) << 16) |
  (channel(color, 8, factor) << 8) |
  channel(color, 0, factor);

class View {
  private measuring = false;
  private ink = 0;
  private gain = 1;
  private readonly dx: number;
  private readonly dy: number;
  private readonly hour: string;
  private readonly minute: string;
  private readonly date: string;

  constructor(
    private readonly dc: Dc,
    frame: Frame,
    private readonly low: boolean,
  ) {
    let hour = frame.hour;
    if (!frame.is24Hour) {
      hour %= 12;
      if (hour === 0) hour = 12;
    }
    this.hour = pad(hour);
    this.minute = pad(frame.min);
    this.date = `${weekday(frame)} ${pad(frame.day)}`;
    const m = Math.floor(frame.epoch / 60);
    this.dx = low ? ((m % 3) - 1) * 2 : 0;
    this.dy = low ? ((Math.floor(m / 3) % 3) - 1) * 2 : 0;
  }

  draw() {
    if (this.low) {
      // Budget the actual strings and every graphic before rendering: at
      // most 9.4% of the screen's full-white light, at Maximum brightness.
      this.measuring = true;
      this.ink = 0;
      this.composition();
      this.measuring = false;
      const budget = 416 * 416 * 0.094;
      this.gain = this.ink > budget ? budget / this.ink : 1;
    }
    this.composition();
  }

  private use(color: number, area: number) {
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    if (this.measuring) {
      this.ink += (area * (0.3 * r + 0.6 * g + 0.1 * b)) / 255;
      return;
    }
    this.dc.setColor(shade(color, this.gain), TRANSPARENT);
  }

  private txt(
    x: number,
    y: number,
    font: number,
    value: string,
    color: number,
    justify: Justify,
  ) {
    if (this.measuring) {
      const table = INK[INK_OF_SLOT[font]];
      let area = 0;
      for (const character of value) {
        const index = INK_CHARS.indexOf(character);
        area += index < 0 ? 1000 : table[index];
      }
      this.use(color, area);
      return;
    }
    this.use(color, 0);
    this.dc.drawText(
      Math.round(x) + this.dx,
      Math.round(y) + this.dy - TOPS[font],
      font,
      value,
      justify,
    );
  }

  private left(
    x: number,
    y: number,
    font: number,
    value: string,
    color: number,
  ) {
    this.txt(x, y, font, value, color, 'left');
  }

  private mid(
    x: number,
    y: number,
    font: number,
    value: string,
    color: number,
  ) {
    this.txt(x, y, font, value, color, 'center');
  }

  private fitLeft(
    x: number,
    y: number,
    font: number,
    value: string,
    color: number,
    width: number,
  ) {
    if (this.dc.getTextWidth(font, value) > width) font = LABEL;
    if (this.dc.getTextWidth(font, value) > width) font = SMALL;
    this.left(x, y, font, value, color);
  }

  private line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    width: number,
  ) {
    if (this.measuring) {
      const length = Math.hypot(x2 - x1, y2 - y1);
      this.use(color, (length + width + 2) * (width + 2));
      return;
    }
    this.use(color, 0);
    this.dc.setPenWidth(width);
    this.dc.drawLine(x1 + this.dx, y1 + this.dy, x2 + this.dx, y2 + this.dy);
    this.dc.setPenWidth(1);
  }

  private circle(
    x: number,
    y: number,
    r: number,
    color: number,
    filled: boolean,
  ) {
    this.use(
      color,
      filled ? Math.PI * (r + 1) * (r + 1) : 2 * Math.PI * (r + 1) * 3,
    );
    if (this.measuring) return;
    // The watch takes whole-pixel centres, and draws the dial's 0.6-pixel
    // dots a pixel across.
    x = Math.trunc(x) + this.dx;
    y = Math.trunc(y) + this.dy;
    if (filled) this.dc.fillCircle(x, y, Math.max(r, 1));
    else this.dc.drawCircle(x, y, r);
  }

  private box(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    filled: boolean,
  ) {
    this.use(color, filled ? (w + 1) * (h + 1) : 2 * (w + h) * 3);
    if (this.measuring) return;
    x += this.dx;
    y += this.dy;
    if (filled) {
      this.dc.fillRectangle(x, y, w, h);
      return;
    }
    // Graphics.drawRectangle: a one-pixel outline inside the box.
    this.dc.fillRectangle(x, y, w, 1);
    this.dc.fillRectangle(x, y + h - 1, w, 1);
    this.dc.fillRectangle(x, y, 1, h);
    this.dc.fillRectangle(x + w - 1, y, 1, h);
  }

  private ticks(
    start: number,
    stop: number,
    step: number,
    radius: number,
    color: number,
  ) {
    for (let degree = start; degree <= stop; degree += step) {
      const a = (degree * Math.PI) / 180;
      const major = degree % 30 === 0;
      const inner = radius - (major ? 8 : 3);
      this.line(
        208 + Math.sin(a) * inner,
        208 - Math.cos(a) * inner,
        208 + Math.sin(a) * radius,
        208 - Math.cos(a) * radius,
        color,
        major ? 2 : 1,
      );
    }
  }

  // The fixture is partly sunny: a sun behind a small solid cloud, which
  // stays recognisable at watch size, standby included.
  private weatherIcon(x: number, y: number, size: number) {
    const sx = x - size * 0.3;
    const sy = y - size * 0.3;
    this.circle(sx, sy, size * 0.36, SUN, !this.low);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      this.line(
        sx + Math.cos(a) * size * 0.5,
        sy + Math.sin(a) * size * 0.5,
        sx + Math.cos(a) * size * 0.69,
        sy + Math.sin(a) * size * 0.69,
        SUN,
        2,
      );
    }
    this.circle(x - size * 0.35, y + 2, size * 0.27, WHITE, true);
    this.circle(x, y - 3, size * 0.39, WHITE, true);
    this.circle(x + size * 0.38, y + 3, size * 0.25, WHITE, true);
    this.line(
      x - size * 0.42,
      y + size * 0.3,
      x + size * 0.42,
      y + size * 0.3,
      WHITE,
      2,
    );
  }

  private arrow(x: number, y: number, up: boolean) {
    const d = up ? -1 : 1;
    this.line(x, y - 5 * d, x, y + 5 * d, WHITE, 2);
    this.line(x, y + 5 * d, x - 4, y + d, WHITE, 2);
    this.line(x, y + 5 * d, x + 4, y + d, WHITE, 2);
  }

  // Rain chance, after a droplet.
  private extra(x: number, y: number) {
    this.circle(x + 7, y + 9, 4, WATER, !this.low);
    this.line(x + 3, y + 7, x + 7, y, WATER, 2);
    this.line(x + 7, y, x + 11, y + 7, WATER, 2);
    this.left(x + 24, y - 1, SMALL, WEATHER.rain, WHITE);
  }

  // Battery, after a gauge filled in the accent.
  private metric(x: number, y: number) {
    this.box(x, y + 2, 21, 11, WHITE, false);
    this.box(x + 22, y + 5, 2, 5, WHITE, true);
    const fill = Math.trunc(Math.max(0, Math.min(15, BATTERY * 0.15)));
    this.box(x + 3, y + 5, fill, 5, ACCENT, true);
    this.left(x + 30, y - 1, SMALL, `${BATTERY}%`, WHITE);
  }

  // The hour in white and the minutes in the accent, centred as one.
  private digital(x: number, y: number) {
    const font = this.low ? AOD : CLOCK;
    const hour = `${this.hour}:`;
    const width = this.dc.getTextWidth(font, hour + this.minute);
    const start = Math.floor(x - width / 2);
    this.left(start, y, font, hour, WHITE);
    this.left(
      start + this.dc.getTextWidth(font, hour),
      y,
      font,
      this.minute,
      ACCENT,
    );
  }

  private composition() {
    const c = shade(ACCENT, 0.7);
    this.ticks(0, 330, 30, 193, c);
    for (const [a, b] of LINKS)
      this.line(STARS[a][0], STARS[a][1], STARS[b][0], STARS[b][1], c, 1);
    STARS.forEach(([x, y], i) =>
      this.circle(x, y, i % 3 === 0 ? 2 : 1, ACCENT, true),
    );
    for (let d = 0; d < 360; d += 5) {
      const r = (d * Math.PI) / 180;
      this.circle(
        208 + Math.sin(r) * 179,
        208 - Math.cos(r) * 179,
        0.6,
        c,
        true,
      );
    }
    // A decorative crescent, explicitly not a live lunar phase.
    this.circle(208, 65, 14, ACCENT, true);
    this.circle(214, 60, 13, 0x000000, true);
    this.mid(208, 15, SMALL, 'N', WHITE);
    this.mid(208, 385, SMALL, 'S', WHITE);

    this.box(99, 130, 223, 28, 0x000000, true);
    this.left(118, 135, LABEL, this.date, WHITE);
    this.metric(248, 138);
    this.digital(208, 178);

    this.box(89, 275, 235, 58, 0x000000, true);
    this.weatherIcon(108, 292, 25);
    this.fitLeft(143, 277, STAT, WEATHER.temp, WHITE, 84);
    this.line(234, 278, 234, 327, shade(ACCENT, 0.5), 1);
    this.arrow(254, 285, true);
    this.left(268, 277, LABEL, WEATHER.high, WHITE);
    this.arrow(254, 312, false);
    this.left(268, 304, LABEL, WEATHER.low, WHITE);
    this.extra(130, 316);
  }
}

export function drawActive(dc: Dc, frame: Frame) {
  new View(dc, frame, false).draw();
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  new View(dc, frame, true).draw();
}
