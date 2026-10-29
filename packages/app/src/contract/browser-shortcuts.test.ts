import { expect, test } from "vitest";
import { repeatsWhenHeld, resolveBrowserShortcut } from "./browser-shortcuts.ts";

function key(init: { key: string; code: string; shiftKey?: boolean; altKey?: boolean }) {
  return { ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, ...init };
}

test("letters follow the layout, and another script falls back to the physical key", () => {
  expect(resolveBrowserShortcut(key({ key: "r", code: "KeyR" }), true, "page")).toBe("reload");
  expect(resolveBrowserShortcut(key({ key: "p", code: "KeyR" }), true, "page")).toBeUndefined();
  expect(resolveBrowserShortcut(key({ key: "l", code: "KeyP" }), true, "page")).toBe(
    "focus-address",
  );
  expect(resolveBrowserShortcut(key({ key: "\u043a", code: "KeyR" }), true, "page")).toBe("reload");
  expect(resolveBrowserShortcut(key({ key: "\u00e0", code: "Digit0" }), true, "page")).toBe(
    "zoom-reset",
  );
});

test("⌘← and ⌘→ go back and forward from the page, never in the panel's fields", () => {
  const left = key({ key: "ArrowLeft", code: "ArrowLeft" });
  const right = key({ key: "ArrowRight", code: "ArrowRight" });

  expect(resolveBrowserShortcut(left, true, "page")).toBe("back");
  expect(resolveBrowserShortcut(right, true, "page")).toBe("forward");
  expect(resolveBrowserShortcut(left, true, "panel")).toBeUndefined();
  expect(resolveBrowserShortcut(right, true, "panel")).toBeUndefined();
  expect(resolveBrowserShortcut({ ...left, shiftKey: true }, true, "page")).toBeUndefined();
  expect(
    resolveBrowserShortcut({ ...left, metaKey: false, ctrlKey: true }, false, "page"),
  ).toBeUndefined();
});

test("a held key repeats navigation, zoom, and find steps, never a toggle", () => {
  expect(
    (["back", "forward", "zoom-in", "zoom-out", "find-next", "find-previous"] as const).every(
      repeatsWhenHeld,
    ),
  ).toBe(true);
  expect(
    (
      [
        "bookmark",
        "history",
        "toggle-devtools",
        "focus-address",
        "find",
        "reload",
        "hard-reload",
      ] as const
    ).some(repeatsWhenHeld),
  ).toBe(false);
});
