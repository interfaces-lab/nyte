import type { EditorKeymap } from "@nyte-ai/ui/diffs/edit";

/**
 * VS Code's keys where Pierre's own keymap leaves them out or binds them differently: ⌘D adds the next occurrence
 * as whole words when it starts from a bare caret, ⇧⌘K deletes the line and ⇧⌥I puts a caret at the end of each
 * selected line. On the Mac, ⌘[ / ⌘] are GoLand's Back and Forward, which the Editor panel owns, so Pierre's indent
 * less/more leave them; indenting stays on Tab / ⇧Tab, as in GoLand. Every other key keeps Pierre's VS Code binding.
 */
export const EDITOR_KEYMAP: EditorKeymap = [
  {
    bindings: {
      "cmdOrCtrl+d": "selectNextOccurrence",
      "cmdOrCtrl+shift+k": "deleteLines",
      "shift+alt+i": "addCaretPerSelectedLine",
    },
  },
  { platform: "mac", bindings: { "cmd+[": "none", "cmd+]": "none" } },
];
