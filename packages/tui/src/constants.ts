/**
 * Fixed chrome copy and keycap strings for the TUI shell. Nothing here touches
 * a renderer, so tests can assert against them directly.
 */
import process from "node:process";
import { stringifyKeyStroke } from "@opentui/keymap";
import type { KeyStrokeInput } from "@opentui/keymap";
import { defaultBindingParser } from "@opentui/keymap/addons";

/** Acceptance modes used by the slash command API, including mouse activation. */
export const COMPLETION_METHODS = { accept: "return", fill: "tab" } as const;

/**
 * The default key for each chat command, and the list of chat commands.
 * `src/keymap.ts` binds them and the hint rows below read their keycaps
 * straight off this record, so a rebind cannot leave the shell advertising a
 * key that no longer does anything.
 */
export const CHAT_KEYBINDS = {
  "chat.submit": "return,kpenter",
  "chat.quit": "ctrl+c",
  "completion.accept": `${COMPLETION_METHODS.accept},kpenter`,
  "completion.fill": COMPLETION_METHODS.fill,
  "completion.close": "escape",
  "completion.previous": "up",
  "completion.next": "down",
  "completion.page.up": "pageup",
  "completion.page.down": "pagedown",
  "chat.interrupt": "escape",
  // Ctrl+B belongs to textarea cursor movement; Ctrl+Z is unbound in OpenTUI.
  "chat.job.background": "ctrl+z",
  "chat.scroll.page.up": "pageup",
  "chat.scroll.page.down": "pagedown",
  "chat.scroll.latest": "ctrl+end",
  "chat.message.previous": "ctrl+up",
  "chat.message.next": "ctrl+down",
  "chat.thinking.cycle": "shift+tab",
  "chat.model.next": "ctrl+p",
  "chat.model.previous": "ctrl+shift+p",
  "chat.editor.open": "ctrl+g",
  "chat.attachment.open": "ctrl+space",
  "chat.clipboard.paste": "ctrl+v,super+v,meta+v",
  "chat.queue.open": "ctrl+q",
  "chat.queue.submit": "ctrl+return,ctrl+kpenter",
  "chat.queue.edit": "ctrl+e",
  "chat.queue.delete": "ctrl+d",
  "chat.queue.up": "ctrl+up",
  "chat.queue.down": "ctrl+down",
  "chat.task.stop": "ctrl+x",
  "chat.tools.toggle": "ctrl+o",
  "chat.skills.open": "ctrl+s",
  // Every shortcut here takes a modifier, because a bare printable key is a
  // character first: binding `?` would cost the ability to send `?`.
  "chat.commands.open": "ctrl+k",
  "chat.history.previous": "up",
  "chat.history.next": "down",
  "composer.newline": "shift+return,shift+kpenter,meta+return,meta+kpenter,ctrl+j",
  "picker.accept": "return",
  "picker.close": "escape",
  "picker.previous": "up,ctrl+p,shift+tab",
  "picker.next": "down,ctrl+n,tab",
  "picker.page.up": "pageup",
  "picker.page.down": "pagedown",
  "model.previous": "up,ctrl+p",
  "model.next": "down,ctrl+n",
  "model.decrease": "left",
  "model.increase": "right",
  "model.field.cycle": "tab,shift+tab",
  "tree.close": "escape,ctrl+c",
  "tree.page.up": "left,pageup",
  "tree.page.down": "right,pagedown",
  "tree.fold": "meta+left",
  "tree.unfold": "meta+right",
  "tree.filter.default": "ctrl+d",
  "tree.filter.tools": "ctrl+t",
  "tree.filter.users": "ctrl+u",
  "tree.filter.all": "ctrl+a",
  "tree.filter.next": "ctrl+o",
  "tree.filter.previous": "ctrl+shift+o",
  "tree.copy": "ctrl+x",
  "auth.cancel": "escape,ctrl+c",
  "auth.submit": "return",
  "auth.open": "return,o",
  "auth.copy": "c",
  "workspace.trust": "a",
  "workspace.decline": "q,escape",
  "workspace.accept": "return",
  "workspace.toggle": "up,down,tab,shift+tab",
} as const satisfies Readonly<Record<string, string>>;

export type ChatCommand = keyof typeof CHAT_KEYBINDS;

/** Parse single-stroke alternatives with the installed keymap grammar, not a second parser. */
export function keyStrokes(command: ChatCommand): readonly KeyStrokeInput[] {
  return CHAT_KEYBINDS[command].split(",").map((input) => {
    const parsed = defaultBindingParser({
      input,
      index: 0,
      layer: {},
      tokens: new Map(),
      patterns: new Map(),
      normalizeTokenName: (name) => name,
      createMatch: (id) => id,
      parseObjectKey: (key) => {
        const stroke = { ctrl: false, shift: false, meta: false, super: false, ...key };
        const match = stringifyKeyStroke(stroke);
        return { stroke, match, display: match };
      },
    });
    const part = parsed?.parts[0];
    if (part === undefined || parsed?.parts.length !== 1 || parsed.nextIndex !== input.length)
      throw new Error(`Expected a single key stroke for ${command}: ${input}`);
    return part.stroke;
  });
}

/** Keycaps read the way they are printed: `esc` and `enter`, not `escape` and `return`. */
const KEYCAP_NAMES: Readonly<Record<"escape" | "return", string>> = {
  escape: "esc",
  return: "enter",
};

function isKeycapName(name: string): name is keyof typeof KEYCAP_NAMES {
  return Object.hasOwn(KEYCAP_NAMES, name);
}

/** The first of a command's keys, which is the one worth advertising. */
export function keycap(command: ChatCommand, style?: "symbol"): string {
  const [primary = ""] = CHAT_KEYBINDS[command].split(",");
  if (style === "symbol")
    return primary.replace(
      /up|down|left|right|return/gu,
      (name) => ({ up: "↑", down: "↓", left: "←", right: "→", return: "↵" })[name] ?? name,
    );
  return primary.replace(/[^+]+$/u, (name) => (isKeycapName(name) ? KEYCAP_NAMES[name] : name));
}

export const COMPOSER_PLACEHOLDER = "Plan, search, build anything";
/** Enter steers the live run; the hint row names the queue key. */
export const BUSY_COMPOSER_PLACEHOLDER = "Steer the run";
export const ANSWER_COMPOSER_PLACEHOLDER = `Type an answer, or press ${keycap("picker.accept").replace(/^./u, (letter) => letter.toUpperCase())} to pick one`;

/** Fixed transcript vocabulary and layout values. */
export const ACTIVITY_WORKING_LABEL = " Working";
export const ACTIVITY_THINKING_LABEL = " Thinking…";
export const ACTIVITY_THOUGHT_LABEL = " Thought";
export const ACTIVITY_WORKED_LABEL = "Worked";
export const ACTIVITY_STOPPED_LABEL = "! Stopped";
export const ACTIVITY_FAILED_LABEL = " Failed";
export const ACTIVITY_WAITING_LABEL = " Waiting for your answer";
export const ACTIVITY_RETRY_LABEL = " Retrying";
/**
 * The resolution of `formatDuration`, which prints tenths of a second. A span
 * under it has no label, so the row carries the word alone.
 */
export const MIN_REPORTED_DURATION_MS = 50;
export const RESULT_PREVIEW_LINES = 3;
export const RESULT_TAIL_LINES = 3;
/** Rows a tail-only preview keeps; the label sits above them. */
export const RESULT_TAIL_ONLY_LINES = 6;
export const TOOL_INLINE_PREVIEW_LENGTH = 96;

/**
 * A legacy Windows console (bare ConHost) has no font for the box and arrow
 * glyphs. Modern terminals identify themselves, so anything unrecognized on
 * Windows takes the ASCII fallback. `NYTE_FORCE_LEGACY_CONSOLE=1` forces it on
 * for testing, `=0` forces it off.
 *
 * Based on https://github.com/xai-org/grok-build/blob/07b2f71/crates/codegen/xai-grok-pager-render/src/glyphs.rs
 */
const MODERN_TERMINALS = new Set([
  "alacritty",
  "ghostty",
  "kitty",
  "rio",
  "vscode",
  "wezterm",
  "windowsterminal",
  "zed",
]);

function isLegacyWindowsConsole(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): boolean {
  const forced = env["NYTE_FORCE_LEGACY_CONSOLE"];
  if (forced === "1" || forced === "true") return true;
  if (forced === "0" || forced === "false") return false;
  if (platform !== "win32") return false;
  if (env["WT_SESSION"] !== undefined) return false;
  const brand = (env["TERM_PROGRAM"] ?? "").toLowerCase().replaceAll(/[\s_-]/g, "");
  return !MODERN_TERMINALS.has(brand);
}

/** One-column chrome glyphs keep animated and settled rows aligned. */
export const GLYPHS = {
  /** The composer's prompt and the highlighted menu row take the same arrow. */
  prompt: isLegacyWindowsConsole() ? ">" : "❯",
  /** A steer cuts ahead of the run; a follow-up falls in behind it. */
  steer: isLegacyWindowsConsole() ? "^" : "↑",
  queue: isLegacyWindowsConsole() ? "v" : "↓",
  /** A message still on its way to the store. */
  sending: isLegacyWindowsConsole() ? "~" : "…",
  bullet: "●",
  check: "✓",
  cross: "✗",
  diamond: "◆",
  gutter: "┃",
  rule: "─",
  separator: "│",
  frameBottomLeft: "╰",
  frameBottomRight: "╯",
  ellipsis: "…",
} as const;

export const SPACING = {
  block: 1,
  inset: 2,
  insetRight: 1,
} as const;

/** Rows the transcript keeps clear under its last line. */
export const TRANSCRIPT_BOTTOM_PADDING = 1;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] as const;
export const SPINNER_INTERVAL_MS = 130;

/**
 * Rows a delegation card reserves from its first frame to its last. Its
 * height never answers to content: a card that grew while the child worked
 * and shrank when it settled would move every line below it, twice.
 */
export const DELEGATION_ROWS = 3;

/**
 * The gutter's last row: the key that opens what is waiting, plus any rows the
 * height cap had to hide.
 */
export function pendingHint(hidden: number): string {
  const open = `${keycap("chat.queue.open")} pending`;
  return hidden > 0 ? `+${String(hidden)} more · ${open}` : open;
}

export const WORKSPACE_TRUST_TITLE = "Workspace Trust Required";
export const WORKSPACE_TRUST_MESSAGE = "Nyte can execute code and access files in this directory.";
export const WORKSPACE_TRUST_QUESTION = "Do you trust the contents of this directory?";
