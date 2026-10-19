import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import type { Keymap } from "@opentui/keymap";
import { registerCommaBindings } from "@opentui/keymap/addons";
import { registerBaseLayoutFallback } from "@opentui/keymap/addons/opentui";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";

export type AppKeymap = Keymap<Renderable, KeyEvent>;

export function createKeymap(renderer: CliRenderer): AppKeymap {
  const keymap = createDefaultOpenTuiKeymap(renderer);
  registerCommaBindings(keymap);
  registerBaseLayoutFallback(keymap);

  return keymap;
}
