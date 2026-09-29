import { describe, expect, it } from "vitest";
import { dataCodewords, encodeQr, formatBits, rawDataModules, reedSolomon, versionFor } from "./qr";

const SITE = "https://shmuel-lamed.github.io/SongToNotes/";

describe("qr: building blocks", () => {
  it("computes Reed–Solomon codewords that match the published examples", () => {
    // ISO/IEC 18004 Annex I: "01234567", version 1-M.
    const iso = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(reedSolomon(iso, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
    // The well-known "HELLO WORLD" 1-M example.
    const hello = [0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(reedSolomon(hello, 10)).toEqual([0xc4, 0x23, 0x27, 0x77, 0xeb, 0xd7, 0xe7, 0xe2, 0x5d, 0x17]);
  });

  it("knows the capacity of each version at level M", () => {
    expect(rawDataModules(1)).toBe(208);
    expect(dataCodewords(1)).toBe(16);
    expect(dataCodewords(4)).toBe(64);
    expect(dataCodewords(10)).toBe(216);
    expect(dataCodewords(40)).toBe(2334);
    // Byte-mode capacities from the standard's table (level M).
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(42)).toBe(3);
    expect(versionFor(43)).toBe(4);
    expect(versionFor(2331)).toBe(40);
    expect(versionFor(2332)).toBeNull();
  });

  it("codes the format bits with the standard mask", () => {
    // Level M: 101010000010010 for mask 0, 100000011001110 for mask 5, 100101010100000 for mask 7.
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(5)).toBe(0b100000011001110);
    expect(formatBits(7)).toBe(0b100101010100000);
  });
});

describe("qr: the symbol", () => {
  it("encodes the site's address as a version 4 symbol with finders and timing in place", () => {
    const qr = encodeQr(SITE)!;
    expect(qr.version).toBe(4);
    expect(qr.size).toBe(33);
    const m = qr.modules;
    // Finder corners: dark ring, light ring, dark core.
    for (const [x, y] of [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ]) {
      expect(m[y][x]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
      expect(m[y + 3][x + 3]).toBe(true);
    }
    // Timing row and column alternate between the finders.
    for (let i = 8; i < qr.size - 8; i += 1) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    expect(m[qr.size - 8][8]).toBe(true); // the dark module
    // Version 4 has one alignment pattern, centred at (26, 26).
    expect(m[26][26]).toBe(true);
    expect(m[25][26]).toBe(false);
  });

  it("keeps producing the matrix that jsQR and OpenCV decoded back to the address", () => {
    // Verified out of tree: the symbols for 1..2300 bytes (versions 1–40)
    // decode with jsQR and OpenCV; this fingerprint guards against drift.
    const qr = encodeQr(SITE)!;
    const bits = qr.modules.map((row) => row.map((dark) => (dark ? "1" : "0")).join("")).join("");
    let hash = 0x811c9dc5;
    for (const c of bits) {
      hash ^= c.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    expect(qr.mask).toBe(2);
    expect(hash.toString(16)).toBe("b84e6098");
  });

  it("handles Hebrew as UTF-8 bytes and refuses text past version 40", () => {
    // Nine Hebrew letters are two bytes each, plus a space: 19 bytes, past version 1's 14.
    expect(encodeQr("כלי מוזיקה")!.version).toBe(2);
    expect(encodeQr("x".repeat(2332))).toBeNull();
    for (const text of ["", "a", "x".repeat(200)]) {
      const qr = encodeQr(text)!;
      expect(qr.modules).toHaveLength(qr.size);
      expect(qr.modules.every((row) => row.length === qr.size)).toBe(true);
    }
  });
});
