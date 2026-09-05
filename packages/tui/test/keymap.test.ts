/** Keyboard routing, displayed shortcuts, and editor behavior. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createTestKeymap } from "@opentui/keymap/testing";
import { keycap, type ChatCommand } from "../src/constants.ts";
import {
  ctrlCAction,
  DoubleEscape,
  escapeIntent,
  installChatAddons,
  nextThinkingLevel,
  registerChatLayer,
  type ChatCommands,
  type ChatCommandSpec,
} from "../src/keymap.ts";

/** One spec per chat command, so the layer registers the whole table. */
function commandsThatDecline(decline: ReadonlySet<ChatCommand>): Partial<ChatCommands> {
  const spec = (name: ChatCommand): ChatCommandSpec => ({
    title: name,
    run: () => !decline.has(name),
  });
  return {
    "chat.interrupt": spec("chat.interrupt"),
    "chat.scroll.page.up": spec("chat.scroll.page.up"),
    "chat.scroll.page.down": spec("chat.scroll.page.down"),
    "chat.message.previous": spec("chat.message.previous"),
    "chat.message.next": spec("chat.message.next"),
    "chat.thinking.cycle": spec("chat.thinking.cycle"),
    "chat.model.next": spec("chat.model.next"),
    "chat.model.previous": spec("chat.model.previous"),
    "chat.editor.open": spec("chat.editor.open"),
    "chat.attachment.open": spec("chat.attachment.open"),
    "chat.clipboard.paste": spec("chat.clipboard.paste"),
    "chat.queue.open": spec("chat.queue.open"),
    "chat.queue.submit": spec("chat.queue.submit"),
    "chat.tools.toggle": spec("chat.tools.toggle"),
    "chat.skills.open": spec("chat.skills.open"),
    "chat.commands.open": spec("chat.commands.open"),
    "chat.history.previous": spec("chat.history.previous"),
    "chat.history.next": spec("chat.history.next"),
  };
}

test("a command that declines leaves the key for the editor, and a disabled layer sees nothing", () => {
  const harness = createTestKeymap();
  installChatAddons(harness.keymap);
  let enabled = true;
  registerChatLayer(harness.keymap, {
    enabled: () => enabled,
    commands: commandsThatDecline(new Set(["chat.history.previous"])),
  });

  const declined = harness.host.press("up");
  assert.equal(declined.defaultPrevented, false);

  const taken = harness.host.press("g", { ctrl: true });
  assert.equal(taken.defaultPrevented, true);

  enabled = false;
  const disabled = harness.host.press("g", { ctrl: true });
  assert.equal(disabled.defaultPrevented, false);
  harness.cleanup();
});

test("the advertised keycaps are the bound keys, printed the way a keyboard prints them", () => {
  assert.equal(keycap("chat.interrupt"), "esc");
  assert.equal(keycap("chat.queue.submit"), "ctrl+enter");
  assert.equal(keycap("chat.commands.open"), "ctrl+k");
});

test("escape stops a run, opens the tree from an empty composer, and yields to a draft or a menu", () => {
  const base = { selecting: false, prompting: false, hasDraft: false, busy: false };
  assert.equal(escapeIntent({ ...base, busy: true }), "abort");
  assert.equal(escapeIntent(base), "open_tree");
  assert.equal(escapeIntent({ ...base, hasDraft: true }), "ignore");
  assert.equal(escapeIntent({ ...base, selecting: true, busy: true }), "ignore");
  assert.equal(escapeIntent({ ...base, prompting: true }), "ignore");
});

test("a second escape within the window pairs; a third starts over", () => {
  const escape = new DoubleEscape();
  assert.equal(escape.press(1_000), false);
  assert.equal(escape.press(1_400), true);
  assert.equal(escape.press(1_500), false);
  assert.equal(escape.press(2_100), false);
});

test("ctrl+c clears a draft before it quits", () => {
  const key = { name: "c", ctrl: true };
  assert.equal(
    ctrlCAction(key, { selecting: false, prompting: false, hasDraft: true }),
    "clear_for_quit",
  );
  assert.equal(
    ctrlCAction(key, { selecting: false, prompting: false, hasDraft: false }),
    "shutdown",
  );
  assert.equal(ctrlCAction(key, { selecting: true, prompting: false, hasDraft: true }), undefined);
  assert.equal(ctrlCAction(key, { selecting: false, prompting: true, hasDraft: false }), undefined);
  assert.equal(
    ctrlCAction({ name: "c", ctrl: false }, { selecting: false, prompting: false, hasDraft: true }),
    undefined,
  );
});

test("thinking levels cycle and wrap, and a lone level cannot cycle", () => {
  assert.equal(nextThinkingLevel("low", ["low", "medium", "high"]), "medium");
  assert.equal(nextThinkingLevel("high", ["low", "medium", "high"]), "low");
  assert.equal(nextThinkingLevel("off", ["off"]), undefined);
});
