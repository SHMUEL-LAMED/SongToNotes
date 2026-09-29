/**
 * A compact QR Code encoder: byte mode, error-correction level M, the
 * smallest version (1..40) that holds the text, and the mask with the lowest
 * penalty score, per ISO/IEC 18004. It exists so the song card can print a
 * scannable link to the site without pulling in a dependency; it follows the
 * structure of Project Nayuki's reference implementation (MIT), cut down to
 * the one mode and one level the site needs.
 */

export type QrCode = {
  version: number;
  /** Modules per side: 17 + 4 × version. */
  size: number;
  /** modules[y][x], true for a dark module. */
  modules: boolean[][];
  mask: number;
};

// Level M only. Index 0 is unused so the version can index directly.
const ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38,
  40, 43, 45, 47, 49,
];
/** The two format bits that name level M. */
const ECL_BITS_M = 0;

/** Modules available for data and ECC once every function pattern is placed. */
export function rawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) a version holds at level M. */
export function dataCodewords(version: number) {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK_M[version] * BLOCKS_M[version];
}

/** Bits a byte-mode segment of `bytes` bytes needs in this version. */
function segmentBits(version: number, bytes: number) {
  return 4 + (version < 10 ? 8 : 16) + bytes * 8;
}

/** The smallest version that holds `bytes` bytes, or null past version 40. */
export function versionFor(bytes: number): number | null {
  for (let version = 1; version <= 40; version += 1) {
    if (segmentBits(version, bytes) <= dataCodewords(version) * 8) return version;
  }
  return null;
}

/* ---- Reed–Solomon over GF(2^8), polynomial 0x11D ---- */

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The ECC codewords for one block of data. Exported for the test vector. */
export function reedSolomon(data: readonly number[], degree: number) {
  const divisor = rsDivisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < result.length; i += 1) result[i] ^= gfMultiply(divisor[i], factor);
  }
  return result;
}

/** Splits the data into blocks, adds each block's ECC, and interleaves them. */
function withEcc(data: number[], version: number) {
  const blocks = BLOCKS_M[version];
  const eccLen = ECC_PER_BLOCK_M[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const chunk = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += chunk.length;
    const ecc = reedSolomon(chunk, eccLen);
    // A placeholder keeps short and long blocks aligned for interleaving.
    if (i < shortBlocks) chunk.push(0);
    all.push(chunk.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < all[0].length; i += 1) {
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/** Mode indicator, length, bytes, terminator and padding, as codewords. */
function dataStream(bytes: Uint8Array, version: number) {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  return out;
}

/** The 15 format bits for level M and a mask, BCH-coded and XOR-masked. */
export function formatBits(mask: number) {
  const data = (ECL_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function alignmentPositions(version: number, size: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Penalty rules N1–N4 of the standard; lower is easier for a scanner. */
export function penalty(modules: boolean[][]) {
  const size = modules.length;
  let score = 0;
  const line = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i += 1) {
      let run = 1;
      for (let j = 1; j <= size; j += 1) {
        if (j < size && get(i, j) === get(i, j - 1)) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // Finder-like 1:1:3:1:1 with four light modules on either side.
      for (let j = 0; j + 10 < size; j += 1) {
        const at = (k: number) => get(i, j + k);
        const core = at(0) && !at(1) && at(2) && at(3) && at(4) && !at(5) && at(6);
        const coreLate = at(4) && !at(5) && at(6) && at(7) && at(8) && !at(9) && at(10);
        if (core && !at(7) && !at(8) && !at(9) && !at(10)) score += 40;
        if (coreLate && !at(0) && !at(1) && !at(2) && !at(3)) score += 40;
      }
    }
  };
  line((i, j) => modules[i][j]);
  line((i, j) => modules[j][i]);
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) dark += 1;
      if (x + 1 < size && y + 1 < size) {
        const c = modules[y][x];
        if (modules[y][x + 1] === c && modules[y + 1][x] === c && modules[y + 1][x + 1] === c) score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Encodes text (as UTF-8) into a QR Code, or null when it is too long. */
export function encodeQr(text: string): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null) return null;
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  // Timing patterns, then finders (with separators) over them.
  for (let i = 0; i < size; i += 1) {
    fn(6, i, i % 2 === 0);
    fn(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        fn(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(version, size);
  const last = align.length - 1;
  for (let i = 0; i < align.length; i += 1) {
    for (let j = 0; j < align.length; j += 1) {
      // The three corners taken by the finders get no alignment pattern.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) fn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) fn(8, i, bit(i));
    fn(8, 7, bit(6));
    fn(8, 8, bit(7));
    fn(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) fn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) fn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) fn(8, size - 15 + i, bit(i));
    fn(8, size - 8, true); // the lone dark module
  };
  drawFormat(0); // reserves the area; the real bits come after masking

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      fn(a, b, dark);
      fn(b, a, dark);
    }
  }

  // Codewords zig-zag up and down two-column strips from the right edge.
  const codewords = withEcc(dataStream(bytes, version), version);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x] || index >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
        index += 1;
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
    }
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    applyMask(mask); // XOR again undoes it
  }
  applyMask(best);
  drawFormat(best);
  return { version, size, modules, mask: best };
}
