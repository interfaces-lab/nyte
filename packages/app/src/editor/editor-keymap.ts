import type { EditorKeymap } from "@nyte-ai/ui/diffs/edit";

/**
 * VS Code's keys where Pierre's own keymap leaves them out or binds them differently: ⌘D adds the next occurrence
 * as whole words when it starts from a bare caret, ⇧⌘K deletes the line, ⇧⌥I puts a caret at the end of each
 * selected line, ⌘F2 selects every occurrence (⇧⌘L adds the selection to chat), ⇧⌘Enter inserts a line above,
 * ⌥⌘↑ / ⌥⌘↓ add a caret above or below, and ⌃J joins lines on the Mac. ⇧⌘U toggles case, as in GoLand. Off the
 * Mac ⌃⇧J joins lines, as in GoLand, because ⌃J opens the side chat there. On the Mac, ⌘[ / ⌘] are GoLand's Back
 * and Forward, which the Editor panel owns, so Pierre's indent less/more leave them; indenting stays on Tab / ⇧Tab,
 * as in GoLand. Every other key keeps Pierre's VS Code binding.
 */
export const EDITOR_KEYMAP: EditorKeymap = [
  {
    bindings: {
      "cmdOrCtrl+d": "selectNextOccurrence",
      "cmdOrCtrl+shift+k": "deleteLines",
      "shift+alt+i": "addCaretPerSelectedLine",
      "cmdOrCtrl+F2": "selectAllOccurrences",
      "cmdOrCtrl+shift+u": "toggleCase",
      "cmdOrCtrl+shift+Enter": "startNewLineBefore",
    },
  },
  {
    platform: "mac",
    bindings: {
      "cmd+[": "none",
      "cmd+]": "none",
      "ctrl+j": "joinLines",
      "cmd+alt+ArrowUp": "cloneCaretAbove",
      "cmd+alt+ArrowDown": "cloneCaretBelow",
    },
  },
  {
    platform: "windows",
    bindings: {
      "ctrl+shift+j": "joinLines",
      "ctrl+alt+ArrowUp": "cloneCaretAbove",
      "ctrl+alt+ArrowDown": "cloneCaretBelow",
    },
  },
  { platform: "linux", bindings: { "ctrl+shift+j": "joinLines" } },
];
