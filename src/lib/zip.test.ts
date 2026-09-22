import { describe, expect, it } from "vitest";
import { buildZip, crc32, dosStamp, safeEntryName } from "./zip";

const text = (value: string) => new TextEncoder().encode(value);

describe("crc32", () => {
  it("matches the value the standard checks itself with", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
  });

  it("is zero for nothing", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("the archive", () => {
  it("opens with a local header and closes with the end record", () => {
    const zip = buildZip([{ name: "a.txt", data: text("hello"), date: new Date("2026-03-20T10:30:00") }]);
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const end = zip.slice(zip.length - 22);
    expect(Array.from(end.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(new DataView(end.buffer, end.byteOffset).getUint16(10, true)).toBe(1);
  });

  it("carries the name and the bytes as they are", () => {
    const zip = buildZip([{ name: "שיר.txt", data: text("שלום") }]);
    const whole = new TextDecoder().decode(zip);
    expect(whole).toContain("שיר.txt");
    expect(whole).toContain("שלום");
  });

  it("counts every entry in the end record", () => {
    const zip = buildZip([
      { name: "a", data: text("1") },
      { name: "b", data: text("2") },
      { name: "c", data: text("3") },
    ]);
    const end = zip.slice(zip.length - 22);
    expect(new DataView(end.buffer, end.byteOffset).getUint16(8, true)).toBe(3);
  });
});

describe("names and stamps", () => {
  it("strips what a file system would refuse", () => {
    expect(safeEntryName("a/b:c*?.wav")).toBe("a-b-c--.wav");
    expect(safeEntryName("   ")).toBe("file");
  });

  it("packs the date the way ZIP expects", () => {
    const stamp = dosStamp(new Date("2026-03-20T10:30:20"));
    expect(stamp.date).toBe(((2026 - 1980) << 9) | (3 << 5) | 20);
    expect(stamp.time).toBe((10 << 11) | (30 << 5) | 10);
  });
});
