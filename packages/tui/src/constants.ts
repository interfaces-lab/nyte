/**
 * Fixed chrome copy and keycap strings for the TUI shell. Nothing here touches
 * a renderer, so tests can assert against them directly.
 */
import process from "node:process";

/**
 * The default key for each chat command, and the list of chat commands.
 * `src/keymap.ts` binds them and the hint rows below read their keycaps
 * straight off this record, so a rebind cannot leave the shell advertising a
 * key that no longer does anything.
 */
export const CHAT_KEYBINDS = {
  "chat.interrupt": "escape",
  "chat.scroll.page.up": "pageup",
  "chat.scroll.page.down": "pagedown",
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
  "selection.copy": "ctrl+c,super+c,meta+c",
  "selection.clear": "escape",
  "chat.tools.toggle": "ctrl+o",
  "chat.skills.open": "ctrl+s",
  // Every shortcut here takes a modifier, because a bare printable key is a
  // character first: binding `?` would cost the ability to send `?`.
  "chat.commands.open": "ctrl+k",
  "chat.history.previous": "up",
  "chat.history.next": "down",
} as const satisfies Readonly<Record<string, string>>;

export type ChatCommand = keyof typeof CHAT_KEYBINDS;

/** Keycaps read the way they are printed: `esc` and `enter`, not `escape` and `return`. */
const KEYCAP_NAMES: Readonly<Record<"escape" | "return", string>> = {
  escape: "esc",
  return: "enter",
};

function isKeycapName(name: string): name is keyof typeof KEYCAP_NAMES {
  return Object.hasOwn(KEYCAP_NAMES, name);
}

/** The first of a command's keys, which is the one worth advertising. */
export function keycap(command: ChatCommand): string {
  const [primary = ""] = CHAT_KEYBINDS[command].split(",");
  return primary.replace(/[^+]+$/u, (name) => (isKeycapName(name) ? KEYCAP_NAMES[name] : name));
}

export const IDLE_HINTS = `${keycap("chat.commands.open")} commands · ${keycap("chat.model.next")} model · ${keycap("chat.thinking.cycle")} thinking · ${keycap("chat.editor.open")} editor`;
export const CTRL_C_EXIT_HINT = "ctrl+c again to quit";
export const COMPOSER_PLACEHOLDER = "Plan, search, build anything";
export const BUSY_COMPOSER_PLACEHOLDER = "Add a follow-up";
export const ANSWER_COMPOSER_PLACEHOLDER = "Type an answer, or press Enter to pick one";

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

/** Rows the transcript keeps clear under its last line; the ephemeral slot adds to it. */
export const TRANSCRIPT_BOTTOM_PADDING = 1;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] as const;
export const SPINNER_INTERVAL_MS = 130;

/**
 * The gutter's last row: the key that opens what is waiting, plus any rows the
 * height cap had to hide.
 */
export function pendingHint(hidden: number): string {
  const open = `${keycap("chat.queue.open")} pending`;
  return hidden > 0 ? `+${String(hidden)} more · ${open}` : open;
}

/** Pressing a key and the state it produces read as the same word. */
export function busyHints(lanes: { readonly steer: string; readonly queue: string }): string {
  return `${keycap("chat.interrupt")} stop · enter ${lanes.steer} · ${keycap("chat.queue.submit")} ${lanes.queue}`;
}

/** While a call is parked on a question, Enter answers it; the queue lane still queues. */
export function answerHints(lanes: { readonly queue: string }): string {
  return `${keycap("chat.interrupt")} stop · enter answer · ${keycap("chat.queue.submit")} ${lanes.queue}`;
}

export const WORKSPACE_TRUST_TITLE = "Workspace Trust Required";
export const WORKSPACE_TRUST_MESSAGE = "Nyte can execute code and access files in this directory.";
export const WORKSPACE_TRUST_QUESTION = "Do you trust the contents of this directory?";
