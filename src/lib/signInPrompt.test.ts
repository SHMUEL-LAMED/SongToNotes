import { describe, expect, it } from "vitest";
import { SIGN_IN_AFTER_MS, signInDue } from "./signInPrompt";

describe("signInDue", () => {
  const waited = { spent: SIGN_IN_AFTER_MS, signedIn: false, shownThisVisit: false };

  it("asks once the page has been on screen a few seconds", () => {
    expect(signInDue({ ...waited, spent: SIGN_IN_AFTER_MS - 1 })).toBe(false);
    expect(signInDue(waited)).toBe(true);
  });

  it("never asks somebody who is signed in", () => {
    expect(signInDue({ ...waited, signedIn: true })).toBe(false);
    expect(signInDue({ ...waited, spent: SIGN_IN_AFTER_MS * 100, signedIn: true })).toBe(false);
  });

  it("asks once in a visit, however long it lasts", () => {
    expect(signInDue({ ...waited, shownThisVisit: true })).toBe(false);
    expect(signInDue({ ...waited, spent: SIGN_IN_AFTER_MS * 100, shownThisVisit: true })).toBe(false);
  });
});
