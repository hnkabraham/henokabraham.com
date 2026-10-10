/**
 * The boarding pass's 2D code: a QR code (ISO/IEC 18004) of the project's
 * shared link, so a phone held up to the screen takes the pass with it. Byte
 * mode, error correction level M, versions 1 to 6, which hold any link the
 * board makes; the mask is the one the standard's penalty rules prefer.
 * Small enough to carry in the page rather than add a dependency; checked
 * against Apple's Vision decoder by scripts/check-boarding-code.mjs.
 */

// Level M, by version: error correction codewords per block, and blocks.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
const MAX_VERSION = 6;

// Codewords a version holds, data and error correction together.
const totalCodewords = (version: number) => {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
  }
  return Math.floor(modules / 8);
};
const dataCodewords = (version: number) =>
  totalCodewords(version) - ECC_PER_BLOCK[version] * BLOCKS[version];

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const multiply = (x: number, y: number) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
};
const divisor = (degree: number) => {
  const result = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
};
const remainder = (data: number[], generator: number[]) => {
  const result = generator.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    generator.forEach((coefficient, i) => {
      result[i] ^= multiply(coefficient, factor);
    });
  }
  return result;
};

/** The QR code's modules, row by row; true is dark. */
export function boardingCode(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  // Mode (4 bits), count (8 bits for versions 1 to 9), then the bytes.
  while (
    version <= MAX_VERSION &&
    12 + bytes.length * 8 > dataCodewords(version) * 8
  )
    version++;
  if (version > MAX_VERSION) throw new Error('Too long for a boarding code');
  const capacity = dataCodewords(version) * 8;
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11)
    append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  // Split into blocks, add each block's error correction, interleave.
  const blocks = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const total = totalCodewords(version);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks);
  const generator = divisor(eccLength);
  const split: number[][] = [];
  for (let i = 0, offset = 0; i < blocks; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = remainder(block, generator);
    // Short blocks leave a gap so every block's error correction lines up.
    if (i < shortBlocks) block.push(-1);
    split.push([...block, ...ecc]);
  }
  const codewords: number[] = [];
  for (let i = 0; i < split[0].length; i++)
    for (const block of split) if (block[i] !== -1) codewords.push(block[i]);

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const reserved = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  // Timing patterns, then the three finders with their separators.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, ring !== 2 && ring !== 4);
      }
  // One alignment pattern for versions 2 to 6.
  if (version >= 2) {
    const at = version * 4 + 10;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        set(at + dx, at + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format areas (filled in below) and the dark module.
  const format = (mask: number) => {
    const value = (0b00 << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const word = ((value << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((word >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);

  // The data, in two-module columns zigzagging up and down from the right.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y][x] || index >= codewords.length * 8) continue;
        modules[y][x] =
          ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
        index++;
      }
  }

  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!reserved[y][x] && masks[mask](x, y))
          modules[y][x] = !modules[y][x];
  };
  // The standard's four penalties: runs, blocks, finder look-alikes and
  // imbalance of dark and light.
  const penalty = () => {
    let score = 0;
    const lines = [
      ...modules,
      ...modules.map((_, x) => modules.map((row) => row[x])),
    ];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      const padded = [
        false,
        false,
        false,
        false,
        ...line,
        false,
        false,
        false,
        false,
      ];
      for (let i = 0; i + 11 <= padded.length; i++) {
        const window = padded
          .slice(i, i + 11)
          .map(Number)
          .join('');
        if (window === '10111010000' || window === '00001011101') score += 40;
      }
    }
    for (let y = 0; y + 1 < size; y++)
      for (let x = 0; x + 1 < size; x++) {
        const c = modules[y][x];
        if (
          c === modules[y][x + 1] &&
          c === modules[y + 1][x] &&
          c === modules[y + 1][x + 1]
        )
          score += 3;
      }
    const dark = modules.flat().filter(Boolean).length;
    score +=
      Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    format(mask);
    const score = penalty();
    if (score < lowest) {
      lowest = score;
      best = mask;
    }
    applyMask(mask);
  }
  applyMask(best);
  format(best);
  return modules;
}

/** The dark modules as one SVG path, a horizontal run per stroke. */
export function boardingCodePath(modules: boolean[][]) {
  let path = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let end = x;
      while (end + 1 < row.length && row[end + 1]) end++;
      path += `M${x} ${y}h${end - x + 1}v1h${x - end - 1}z`;
      x = end;
    }
  });
  return path;
}
