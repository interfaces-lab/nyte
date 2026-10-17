import { PasteEvent } from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";

/** Keys and pastes that reached the renderer before the app could take them. */
export interface Typeahead {
  /** Stops holding and replays what was held, in order, through the renderer's own key input. */
  release(): void;
}

/**
 * Holds every key and paste from the moment the renderer reads stdin. Until the app has
 * mounted its keymap and focused the composer nothing takes them, so keys typed at launch
 * would be lost. Call it right after constructing the renderer, before any `await`.
 */
export function holdTypeahead(renderer: CliRenderer): Typeahead {
  const held: (KeyEvent | PasteEvent)[] = [];
  const hold = (event: KeyEvent | PasteEvent): void => void held.push(event);
  renderer.keyInput.on("keypress", hold);
  renderer.keyInput.on("paste", hold);

  return {
    release() {
      renderer.keyInput.off("keypress", hold);
      renderer.keyInput.off("paste", hold);

      for (const event of held.splice(0)) {
        if (event instanceof PasteEvent)
          renderer.keyInput.processPaste(event.bytes, event.metadata);
        else renderer.keyInput.processParsedKey(event);
      }
    },
  };
}
