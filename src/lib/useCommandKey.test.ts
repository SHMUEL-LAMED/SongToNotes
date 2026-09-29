import { describe, expect, it } from "vitest";
import { isCommandKey } from "./useCommandKey";

const press = (overrides: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, key: "", code: "", ...overrides }) as KeyboardEvent;

describe("isCommandKey", () => {
  it("takes Ctrl+K and ⌘K", () => {
    expect(isCommandKey(press({ ctrlKey: true, key: "k", code: "KeyK" }))).toBe(true);
    expect(isCommandKey(press({ metaKey: true, key: "K", code: "KeyK" }))).toBe(true);
  });

  it("takes the K key on a Hebrew layout, where it types ל", () => {
    expect(isCommandKey(press({ ctrlKey: true, key: "ל", code: "KeyK" }))).toBe(true);
  });

  it("does not throw on a keydown without a key, as autofill sends", () => {
    expect(isCommandKey(press({ ctrlKey: true, key: undefined as unknown as string, code: "" }))).toBe(false);
  });

  it("leaves other keys and plain K alone", () => {
    expect(isCommandKey(press({ key: "k", code: "KeyK" }))).toBe(false);
    expect(isCommandKey(press({ ctrlKey: true, key: "j", code: "KeyJ" }))).toBe(false);
    expect(isCommandKey(press({ ctrlKey: true, altKey: true, key: "k", code: "KeyK" }))).toBe(false);
  });
});
