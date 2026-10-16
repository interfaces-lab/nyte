import process from "node:process";
import { stringifyKeyStroke } from "@opentui/keymap";
import type { KeyStrokeInput } from "@opentui/keymap";
import { defaultBindingParser } from "@opentui/keymap/addons";
import type { Thinking } from "@nyte-ai/sdk";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly Thinking[];

const ENTER = "return,kpenter";

export const CHAT_KEYBINDS = {
  "chat.submit": ENTER,
  "chat.quit": "ctrl+c",
  "completion.accept": ENTER,
  "completion.fill": "tab",
  "completion.close": "escape",
  "completion.previous": "up",
  "completion.next": "down",
  "completion.page.up": "pageup",
  "completion.page.down": "pagedown",
  "chat.interrupt": "escape",
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
  "chat.commands.open": "ctrl+k",
  "chat.history.previous": "up",
  "chat.history.next": "down",
  "composer.newline": "shift+return,shift+kpenter,meta+return,meta+kpenter,ctrl+j",
  "composer.delete.to.line.start": "super+backspace,ctrl+u",
  "composer.yank": "ctrl+y",
  "picker.accept": ENTER,
  "picker.close": "escape,ctrl+c",
  "picker.previous": "up,ctrl+p,shift+tab",
  "picker.next": "down,ctrl+n,tab",
  "picker.page.up": "pageup",
  "picker.page.down": "pagedown",
  "picker.detail.up": "ctrl+pageup",
  "picker.detail.down": "ctrl+pagedown",
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
  "tree.filter.all": "ctrl+shift+a",
  "tree.filter.next": "ctrl+o",
  "tree.filter.previous": "ctrl+shift+o",
  "tree.copy": "ctrl+x",
  "auth.cancel": "escape,ctrl+c",
  "auth.submit": ENTER,
  "auth.open": `${ENTER},o`,
  "auth.copy": "c",
} as const satisfies Readonly<Record<string, string>>;

export type ChatCommand = keyof typeof CHAT_KEYBINDS;

export const FIELD_KEYBINDS = {
  "field.left": "left,ctrl+b",
  "field.right": "right,ctrl+f",
  "field.home": "home,super+left",
  "field.end": "end,ctrl+e,meta+e,super+right",
  "field.select.all": "ctrl+a,super+a,meta+a",
  "field.select.left": "shift+left",
  "field.select.right": "shift+right",
  "field.select.home": "shift+home,super+shift+left",
  "field.select.end": "shift+end,super+shift+right",
  "field.select.word.left": "meta+shift+left,ctrl+shift+left",
  "field.select.word.right": "meta+shift+right,ctrl+shift+right",
  "field.word.left": "meta+b,meta+left,ctrl+left",
  "field.word.right": "meta+f,meta+right,ctrl+right",
  "field.delete.left": "backspace,shift+backspace",
  "field.delete.right": "delete,shift+delete,ctrl+d",
  "field.delete.word.left": "ctrl+w,ctrl+backspace,meta+backspace",
  "field.delete.word.right": "meta+d,meta+delete,ctrl+delete",
  "field.delete.home": "ctrl+u,super+backspace",
  "field.delete.end": "ctrl+k",
} as const satisfies Readonly<Record<string, string>>;

export type FieldCommand = keyof typeof FIELD_KEYBINDS;

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

const KEYCAP_NAMES: Readonly<Record<"escape" | "return", string>> = {
  escape: "esc",
  return: "enter",
};

function isKeycapName(name: string): name is keyof typeof KEYCAP_NAMES {
  return Object.hasOwn(KEYCAP_NAMES, name);
}

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

export const BUSY_COMPOSER_PLACEHOLDER = "Steer the run";

export const ANSWER_COMPOSER_PLACEHOLDER = `Type an answer, or press ${keycap("picker.accept").replace(/^./u, (letter) => letter.toUpperCase())} to pick one`;

export const ACTIVITY_WORKING_LABEL = " Working";

export const ACTIVITY_THINKING_LABEL = " Thinking…";

export const ACTIVITY_THOUGHT_LABEL = " Thought";

export const ACTIVITY_WORKED_LABEL = "Worked";

export const ACTIVITY_STOPPED_LABEL = "! Stopped";

export const ACTIVITY_FAILED_LABEL = " Failed";

export const ACTIVITY_WAITING_LABEL = " Waiting for your answer";

export const ACTIVITY_RETRY_LABEL = " Retrying";

export const MIN_REPORTED_DURATION_MS = 50;

export const RESULT_PREVIEW_LINES = 3;

export const RESULT_TAIL_LINES = 3;

export const RESULT_TAIL_ONLY_LINES = 6;

export const TOOL_INLINE_PREVIEW_LENGTH = 96;

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

export const GLYPHS = {
  prompt: isLegacyWindowsConsole() ? ">" : "❯",
  steer: isLegacyWindowsConsole() ? "^" : "↑",
  queue: isLegacyWindowsConsole() ? "v" : "↓",
  sending: isLegacyWindowsConsole() ? "~" : "…",
  report: isLegacyWindowsConsole() ? "<" : "↳",
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

export const TRANSCRIPT_BOTTOM_PADDING = 1;

export const SPINNER_FRAMES = ["⠀⠰", "⠀⡷", "⢸⡷", "⢾⡷", "⢾⡇", "⢾⠀", "⠆⠀"] as const;

export const SPINNER_INTERVAL_MS = 130;

export function pendingHint(hidden: number): string {
  const open = `${keycap("chat.queue.open")} pending`;

  return hidden > 0 ? `+${String(hidden)} more · ${open}` : open;
}
