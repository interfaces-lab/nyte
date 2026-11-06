import { PasteEvent } from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";

export interface Typeahead {
  release(): void;
}

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
