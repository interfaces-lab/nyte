/**
 * Keyboard focus must be visible to navigate at all: a 1px accent hairline,
 * `ring` hugging standalone controls, `ringInset` for rows and menu items that
 * sit flush inside a scroll container or popover, where an outset ring would
 * clip. An outline rather than a box shadow, so it composes with the shadows
 * a control already draws.
 *
 * `t.focusRing` — not `:focus-visible` — is what keeps these off the mouse.
 * Chromium matches `:focus-visible` on every text field focus, so a plain
 * ring lands on any input the user clicked into; a host drops the color to
 * `transparent` until focus arrives by keyboard.
 */
import { create } from "@stylexjs/stylex";

import { appearance } from "./vars.stylex.ts";

export const focus = create({
  ring: {
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
  },
  ringInset: {
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
  },
});

const hidden = create({
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    borderWidth: 0,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
  },
});

/** Visually hidden, still announced: labels a control that reads by shape alone. */
export const srOnly = hidden.srOnly;
