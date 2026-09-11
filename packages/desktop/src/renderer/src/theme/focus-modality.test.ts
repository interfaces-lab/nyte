import { afterAll, describe, expect, test, vi } from "vitest";
import { keyboardNavigates } from "./focus-modality.ts";

// The module wires listeners at import time; the ring rule below is the part
// worth pinning, so the DOM it touches is a stub.
vi.hoisted(() => {
  vi.stubGlobal("document", { documentElement: { dataset: {} }, activeElement: null });
  vi.stubGlobal("window", { addEventListener: () => undefined });
});
afterAll(() => vi.unstubAllGlobals());

describe("keyboardNavigates", () => {
  test("only Tab moves focus out of a field", () => {
    expect(keyboardNavigates("Tab", true)).toBe(true);
    for (const key of ["a", "A", "v", "ArrowLeft", "Enter", "Escape", "Backspace"]) {
      expect(keyboardNavigates(key, true)).toBe(false);
    }
  });

  test("outside a field every real key is navigation", () => {
    for (const key of ["Tab", "ArrowDown", "Enter", " ", "Escape", "Home", "j"]) {
      expect(keyboardNavigates(key, false)).toBe(true);
    }
  });

  test("a held modifier alone earns no ring", () => {
    for (const key of ["Shift", "Meta", "Control", "Alt", "CapsLock"]) {
      expect(keyboardNavigates(key, false)).toBe(false);
      expect(keyboardNavigates(key, true)).toBe(false);
    }
  });
});
