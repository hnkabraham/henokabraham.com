// Meridian, from StudioView.mc (StudioStyle 2): a field-watch dial, ivory
// sword hands over olive minute track, numerals at the quarters and a
// framed digital time above two data fields.
import {
  type Dc,
  type Frame,
  type Justify,
  type SlotMetrics,
  TRANSPARENT,
} from './watch-face-dc';

const ACCENT = 0xa3af6d;
const WHITE = 0xfff2d6;
// The radius StudioView keeps centred text inside.
const SAFE = 170;

// StudioFonts, one slot per index the view uses. Roboto Condensed is the
// watch's own face, sized from the em the project measured (size × 2048 /
// 2400) with its cap top 444 units below the ascender, where drawText's y
// sits; BionicBold's figures are 23/56 of the size wide and its colon 9/56,
// as the native layout replay measures them.
const BIONIC = [0, 2, 11, 19];
const REGULAR = [1, 3, 5, 7, 9, 13, 14, 16];
const SIZES = [
  56, 40, 47, 34, 28, 28, 32, 32, 18, 18, 16, 84, 18, 80, 16, 24, 24, 40, 34,
  120, 80,
];
const TOPS = [
  12, 7, 10, 6, 5, 5, 6, 6, 3, 3, 3, 19, 3, 14, 3, 4, 4, 7, 6, 27, 14,
];
const CAPS = [
  29, 30, 25, 26, 22, 21, 25, 24, 15, 14, 13, 43, 15, 60, 12, 19, 19, 31, 27,
  61, 62,
];
const DIGITS = [
  29, 26, 25, 22, 18, 18, 20, 20, 12, 12, 10, 43, 12, 50, 10, 16, 16, 26, 22,
  61, 50,
];

export const fonts: SlotMetrics[] = SIZES.map((size, slot) => {
  if (BIONIC.includes(slot))
    return {
      n: [TOPS[slot], CAPS[slot], (size * 23) / 56, (size * 9) / 56],
      l: [TOPS[slot], CAPS[slot]],
    };
  const em = (size * 2048) / 2400;
  return {
    n: null,
    l: [(em * 444) / 2048, em * 0.7109375],
    regular: REGULAR.includes(slot),
  };
});

// Slots, as StudioSlot names them.
const CLOCK_BIONIC = 0;
const SMALL_BIONIC = 2;
const VALUE_BOLD = 4;
const LABEL_BOLD = 8;
const MINIMUM_BOLD = 10;
const NUMERAL = 11;
const TINY_BOLD = 12;
const MEDIUM_BOLD = 15;

// Each glyph's lit area, for the always-on light budget: StudioFonts.ink for
// the slots this face can draw.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 %:-/.,+';
const FIGURES = '0123456789:';
const table = (keys: string, values: number[]) =>
  Object.fromEntries(keys.split('').map((key, index) => [key, values[index]]));
const INK: Record<number, Record<string, number>> = {
  0: table(FIGURES, [406, 212, 363, 366, 343, 397, 406, 274, 433, 409, 93]),
  2: table(FIGURES, [288, 151, 258, 260, 244, 282, 288, 195, 307, 290, 67]),
  4: table(
    LETTERS,
    [
      133, 160, 124, 145, 126, 106, 146, 150, 69, 90, 146, 88, 214, 167, 146,
      130, 157, 152, 130, 98, 141, 126, 203, 135, 104, 119, 131, 75, 113, 114,
      114, 118, 121, 89, 136, 119, 4, 112, 30, 22, 55, 17, 26, 71,
    ],
  ),
  8: table(
    LETTERS,
    [
      58, 68, 53, 63, 54, 46, 62, 64, 32, 41, 64, 39, 91, 71, 63, 56, 68, 66,
      56, 42, 61, 54, 86, 58, 46, 51, 57, 34, 50, 50, 49, 51, 53, 39, 59, 52, 4,
      49, 15, 12, 25, 10, 13, 32,
    ],
  ),
  10: table(
    LETTERS,
    [
      47, 54, 43, 49, 43, 37, 50, 51, 25, 32, 50, 31, 73, 57, 50, 44, 54, 51,
      46, 35, 48, 44, 70, 47, 37, 41, 46, 28, 40, 40, 40, 41, 43, 32, 48, 42, 4,
      40, 13, 10, 21, 9, 11, 26,
    ],
  ),
  11: table(FIGURES, [910, 472, 813, 820, 768, 889, 909, 611, 971, 918, 205]),
  15: table(
    LETTERS,
    [
      99, 118, 91, 110, 94, 80, 107, 112, 53, 69, 110, 67, 158, 124, 110, 99,
      118, 115, 97, 73, 106, 94, 150, 100, 78, 88, 97, 56, 84, 85, 84, 87, 90,
      67, 101, 89, 4, 83, 23, 17, 41, 14, 20, 53,
    ],
  ),
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// The demo fixture (StudioMetrics.refresh): steps first, battery second, the
// third field hidden.
const FIELDS = [
  { value: '8,742', label: 'STEPS', short: 'STP' },
  { value: '84%', label: 'BAT', short: 'BAT' },
];

// Monkey C colour arithmetic is in 32-bit floats, truncated to integers.
const f32 = Math.fround;
function shade(color: number, factor: number) {
  const scale = (channel: number) => Math.trunc(f32(channel * f32(factor)));
  return (
    (scale((color >> 16) & 255) << 16) |
    (scale((color >> 8) & 255) << 8) |
    scale(color & 255)
  );
}
function mix(first: number, second: number, portion: number) {
  const p = f32(portion);
  const q = f32(1 - p);
  const blend = (a: number, b: number) =>
    Math.trunc(f32(f32(a * q) + f32(b * p)));
  return (
    (blend((first >> 16) & 255, (second >> 16) & 255) << 16) |
    (blend((first >> 8) & 255, (second >> 8) & 255) << 8) |
    blend(first & 255, second & 255)
  );
}

function compose(dc: Dc, frame: Frame, low: boolean) {
  // render(): always-on moves two pixels a minute through a 3 × 3 grid.
  const minute = Math.floor(frame.epoch / 60);
  const dx = low ? ((minute % 3) - 1) * 2 : 0;
  const dy = low ? ((Math.floor(minute / 3) % 3) - 1) * 2 : 0;
  let gain = 1;
  let ink = 0;
  let measure = false;

  // setClock and setDate: a 12-hour watch drops the hour's leading zero.
  let hour = frame.hour;
  if (!frame.is24Hour) {
    hour %= 12;
    if (hour === 0) hour = 12;
  }
  const hourText = frame.is24Hour
    ? String(hour).padStart(2, '0')
    : String(hour);
  const minuteText = String(frame.min).padStart(2, '0');
  const dateText = `${WEEKDAYS[frame.weekday]} ${String(frame.day).padStart(2, '0')}`;

  const paint = (color: number, area: number) => {
    if (measure)
      ink +=
        (area *
          (0.3 * ((color >> 16) & 255) +
            0.6 * ((color >> 8) & 255) +
            0.1 * (color & 255))) /
        255;
    else dc.setColor(shade(color, gain), TRANSPARENT);
  };
  const decor = (color: number) => (low ? shade(color, 0.5) : color);
  const labelColor = () => (low ? mix(ACCENT, WHITE, 0.35) : ACCENT);
  const height = (font: number) => CAPS[font];
  const figures = (font: number) => DIGITS[font];
  const width = (value: string, font: number) => dc.getTextWidth(font, value);

  const txt = (
    center: number,
    top: number,
    font: number,
    value: string,
    color: number,
    justify: Justify,
  ) => {
    const size = width(value, font);
    let area = 0;
    for (const character of value)
      area += INK[font]?.[character] ?? size * height(font);
    paint(color, area);
    if (!measure)
      dc.drawText(
        Math.round(center) + dx,
        Math.round(top) + dy - TOPS[font],
        font,
        value,
        justify,
      );
  };
  const mid = (
    center: number,
    top: number,
    font: number,
    value: string,
    color: number,
  ) => txt(center, top, font, value, color, 'center');
  const left = (
    origin: number,
    top: number,
    font: number,
    value: string,
    color: number,
  ) => txt(origin, top, font, value, color, 'left');

  // Horizontal room for centred text inside the face's rings.
  const safeWidth = (
    center: number,
    top: number,
    font: number,
    maximum: number,
  ) => {
    const distance = Math.max(
      Math.abs(top - 208),
      Math.abs(top + height(font) - 208),
    );
    const horizontal = Math.abs(center - 208);
    const half =
      distance < SAFE
        ? Math.sqrt(SAFE * SAFE - distance * distance) - horizontal
        : 0;
    return maximum < half * 2 ? maximum : Math.floor(half * 2);
  };

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    pen: number,
  ) => {
    paint(color, (Math.hypot(x2 - x1, y2 - y1) + pen) * (pen + 0.6));
    if (measure) return;
    dc.setPenWidth(pen);
    dc.drawLine(
      Math.round(x1) + dx,
      Math.round(y1) + dy,
      Math.round(x2) + dx,
      Math.round(y2) + dy,
    );
    dc.setPenWidth(1);
  };
  const circle = (
    x: number,
    y: number,
    radius: number,
    color: number,
    filled: boolean,
  ) => {
    paint(
      color,
      filled
        ? Math.PI * (radius + 0.5) * (radius + 0.5)
        : 2 * Math.PI * (radius + 0.5) * 1.6,
    );
    if (measure) return;
    if (filled) dc.fillCircle(x + dx, y + dy, radius);
    else dc.drawCircle(x + dx, y + dy, radius);
  };
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    color: number,
    filled: boolean,
  ) => {
    paint(color, filled ? w * h : (w + h) * 2 * 1.6);
    if (measure) return;
    if (filled) dc.fillRoundedRectangle(x + dx, y + dy, w, h, radius);
    else dc.drawRoundedRectangle(x + dx, y + dy, w, h, radius);
  };
  const poly = (points: [number, number][], color: number) => {
    let area = 0;
    points.forEach(([x, y], index) => {
      const [nx, ny] = points[(index + 1) % points.length];
      area += x * ny - nx * y;
    });
    paint(color, Math.abs(area) * 0.55 + points.length * 2);
    if (!measure) dc.fillPolygon(points.map(([x, y]) => [x + dx, y + dy]));
  };

  // The time on one line, centred on a vertical middle; Bionic Bold unless
  // "88:88" outgrows the frame.
  const clock = (center: number, middle: number, maximum: number) => {
    const font =
      width('88:88', CLOCK_BIONIC) <= maximum ? CLOCK_BIONIC : SMALL_BIONIC;
    const top = middle - Math.trunc(figures(font) / 2);
    const hours = hourText + ':';
    const start = Math.floor(center - width(hours + minuteText, font) / 2);
    left(start, top, font, hours, WHITE);
    left(start + width(hours, font), top, font, minuteText, WHITE);
  };
  const date = (center: number, top: number, maximum: number) => {
    const choices = [VALUE_BOLD, LABEL_BOLD, MINIMUM_BOLD];
    for (const [index, font] of choices.entries())
      if (
        width(dateText, font) <= safeWidth(center, top, font, maximum) ||
        index === choices.length - 1
      ) {
        mid(center, top, font, dateText, low ? mix(WHITE, WHITE, 0.35) : WHITE);
        return;
      }
  };

  // fieldRow for two visible fields re-centred at 162 and 254: one value size
  // and one label size for the row, the full labels preferred.
  const fieldRow = (top: number) => {
    const centers = [162, 254];
    const widths = [84, 84];
    const values = [VALUE_BOLD, MEDIUM_BOLD];
    const labels = [LABEL_BOLD, MINIMUM_BOLD];
    let valueFont = values[values.length - 1];
    for (const font of values)
      if (
        FIELDS.every(
          (field, index) =>
            width(field.value, font) <=
            safeWidth(centers[index], top, font, widths[index]),
        )
      ) {
        valueFont = font;
        break;
      }
    const labelTop = top + height(valueFont) + 3;
    let texts: string[] | null = null;
    let labelFont = labels[labels.length - 1];
    for (let pass = 0; pass < 2 && !texts; pass++)
      for (const font of labels) {
        let fits = true;
        const picks = FIELDS.map((field, index) => {
          const limit = safeWidth(
            centers[index],
            labelTop,
            font,
            widths[index],
          );
          if (width(field.label, font) <= limit) return field.label;
          fits &&= pass === 1 && width(field.short, font) <= limit;
          return field.short;
        });
        if (fits) {
          texts = picks;
          labelFont = font;
          break;
        }
      }
    texts ??= FIELDS.map((field) => field.short);
    const bottom = labelTop + height(labelFont);
    FIELDS.forEach((field, index) => {
      mid(centers[index], top, valueFont, field.value, WHITE);
      mid(centers[index], labelTop, labelFont, texts![index], labelColor());
    });
    if (!low) line(208, top + 3, 208, bottom - 3, shade(WHITE, 0.3), 1);
  };

  const handPoints = (
    shape: [number, number][],
    breadth: number,
    grow: number,
    sine: number,
    cosine: number,
  ): [number, number][] =>
    shape.map(([along, across]) => {
      const length = along + (along > 0 ? grow : -grow);
      const offset = across * breadth;
      return [
        208 + sine * length + cosine * offset,
        208 - cosine * length + sine * offset,
      ];
    });
  // A sword hand with a dark keyline, legible where it crosses text.
  const sword = (
    angle: number,
    length: number,
    breadth: number,
    color: number,
  ) => {
    const radians = (angle * Math.PI) / 180;
    const sine = Math.sin(radians);
    const cosine = Math.cos(radians);
    const shape: [number, number][] = [
      [-14, 0.3],
      [length * 0.22, 0.5],
      [length * 0.8, 0.5],
      [length, 0],
      [length * 0.8, -0.5],
      [length * 0.22, -0.5],
      [-14, -0.3],
    ];
    poly(handPoints(shape, breadth + 4, 2, sine, cosine), 0);
    poly(handPoints(shape, breadth, 0, sine, cosine), color);
    line(
      208 + sine * length * 0.3,
      208 - cosine * length * 0.3,
      208 + sine * length * 0.74,
      208 - cosine * length * 0.74,
      0x2a2a22,
      3,
    );
  };
  const thinHand = (
    angle: number,
    length: number,
    pen: number,
    color: number,
  ) => {
    const radians = (angle * Math.PI) / 180;
    const sine = Math.sin(radians);
    const cosine = Math.cos(radians);
    line(
      208 - sine * 10,
      208 + cosine * 10,
      208 + sine * (length + 2),
      208 - cosine * (length + 2),
      0,
      pen + 4,
    );
    line(
      208 - sine * 10,
      208 + cosine * 10,
      208 + sine * length,
      208 - cosine * length,
      color,
      pen,
    );
  };
  const hands = () => {
    const hourAngle = (frame.hour % 12) * 30 + frame.min * 0.5;
    if (low) {
      thinHand(hourAngle, 104, 4, WHITE);
      thinHand(frame.min * 6, 160, 2, WHITE);
      circle(208, 208, 4, WHITE, false);
      return;
    }
    sword(hourAngle, 108, 12, WHITE);
    sword(frame.min * 6, 164, 10, WHITE);
    const radians = (frame.sec * 6 * Math.PI) / 180;
    const sine = Math.sin(radians);
    const cosine = Math.cos(radians);
    line(
      208 - sine * 26,
      208 + cosine * 26,
      208 + sine * 150,
      208 - cosine * 150,
      ACCENT,
      2,
    );
    circle(208 + sine * 124, 208 - cosine * 124, 4.5, ACCENT, true);
    circle(208, 208, 10, 0x101210, true);
    circle(208, 208, 10, ACCENT, false);
    circle(208, 208, 3, WHITE, true);
  };

  // meridian(): the hands are drawn last, so no text ever covers them.
  const meridian = () => {
    if (!low) {
      // Full details: the minute track between the five-minute marks, and
      // the five-minute figures outside it.
      for (let m = 0; m < 60; m++) {
        if (m % 5 === 0) continue;
        const angle = (m * 6 * Math.PI) / 180;
        line(
          208 + Math.sin(angle) * 172,
          208 - Math.cos(angle) * 172,
          208 + Math.sin(angle) * 178,
          208 - Math.cos(angle) * 178,
          shade(ACCENT, 0.85),
          1,
        );
      }
      for (let index = 1; index <= 12; index++) {
        const angle = (index * 30 * Math.PI) / 180;
        mid(
          208 + Math.sin(angle) * 190,
          208 - Math.cos(angle) * 190 - Math.trunc(figures(TINY_BOLD) / 2),
          TINY_BOLD,
          String(index * 5).padStart(2, '0'),
          shade(ACCENT, 0.9),
        );
      }
    }
    for (let h = 1; h < 12; h++) {
      if (h % 3 === 0) continue;
      const angle = (h * 30 * Math.PI) / 180;
      line(
        208 + Math.sin(angle) * 140,
        208 - Math.cos(angle) * 140,
        208 + Math.sin(angle) * 160,
        208 - Math.cos(angle) * 160,
        decor(WHITE),
        low ? 2 : 6,
      );
    }
    const half = Math.trunc(figures(NUMERAL) / 2);
    mid(208, 64 - half, NUMERAL, '12', WHITE);
    mid(208, 352 - half, NUMERAL, '6', WHITE);
    mid(352, 208 - half, NUMERAL, '3', WHITE);
    mid(64, 208 - half, NUMERAL, '9', WHITE);
    date(208, 102, 140);
    line(191, 131, 225, 131, decor(ACCENT), 2);
    box(136, 236, 144, 38, 10, 0x0b0d09, true);
    box(136, 236, 144, 38, 10, decor(shade(ACCENT, 0.55)), false);
    clock(208, 255, 132);
    fieldRow(284);
    hands();
  };

  if (low) {
    // Budget the light first, then draw within it at Balanced brightness.
    measure = true;
    meridian();
    measure = false;
    gain = (ink > 12900 ? 12900 / ink : 1) * f32(0.68);
  }
  meridian();
}

export function drawActive(dc: Dc, frame: Frame) {
  compose(dc, frame, false);
}

export function drawAlwaysOn(dc: Dc, frame: Frame) {
  compose(dc, frame, true);
}
