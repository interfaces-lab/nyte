import assert from "node:assert/strict";
import { contentText } from "@nyte-ai/ai";
import { CHAT_KEYBINDS } from "../../src/constants.ts";
import type { ChatCommand } from "../../src/constants.ts";
import { SLASH_COMMANDS } from "../../src/slash.ts";
import type { BuiltinSlashName, SlashCommand } from "../../src/slash.ts";
import type { Fixture } from "./fixture.ts";
import {
  ImageRenderable,
  TextareaRenderable,
  TextRenderable,
  TextTableRenderable,
} from "@opentui/core";
import type { ClipboardRepresentation, Renderable } from "@opentui/core";
import { cellOffset } from "../../src/width.ts";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { existsSync } from "node:fs";
import { runTui } from "../../src/interactive.ts";
import { parseFlags } from "../../src/flags.ts";
import { createWorkspaceTrustStore } from "../../src/workspace-trust.ts";

type Check = (ui: Fixture) => Promise<void>;
export interface Scenario {
  readonly name: string;
  readonly run: Check;
}

async function dismiss(ui: Fixture) {
  await ui.pause();
  await ui.key("ESCAPE");
  await ui.until(() => !ui.shell.selecting && !ui.shell.prompting, "Composer regains focus");
}

async function queue(ui: Fixture) {
  ui.hold();
  await ui.type("hold the reply");
  await ui.key("RETURN");
  await ui.see("Waiting for QA");
  await ui.type("queued QA message");
  await ui.shortcut("chat.queue.submit");
  await ui.until(
    async () => (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length === 1,
    "One durable queued message",
  );
}

async function modelChanged(ui: Fixture) {
  await ui.see("Model: qa/qa-second");
  await ui.until(
    async () =>
      (await ui.host.nyte.sessions.snapshot({ sessionId: ui.sessionId }))?.session.config.model
        ?.id === "qa-second",
    "Model choice reaches durable session configuration",
  );
}

const builtins: Record<BuiltinSlashName, Check> = {
  help: async (ui) => {
    await ui.see("Commands");
    await ui.see("/settings");
    await dismiss(ui);
  },
  settings: async (ui) => {
    await ui.see("Settings");
    await ui.see("Thinking level");
    await dismiss(ui);
  },
  login: async (ui) => {
    await ui.see("QA Provider");
    await ui.key("RETURN");
    await ui.see("QA key");
    await ui.type("new-fixture-key");
    await ui.key("RETURN");
    await ui.see("Signed in to QA Provider");
    assert.deepEqual(await ui.credentials.read("qa"), { type: "api_key", key: "new-fixture-key" });
  },
  logout: async (ui) => {
    await ui.see("Signed out of QA Provider");
    assert.equal(await ui.credentials.read("qa"), undefined);
  },
  quit: async (ui) => {
    await ui.until(ui.didQuit, "Quit requests shutdown");
  },
  resume: async (ui) => {
    await ui.see("Resume chat");
    await ui.key("RETURN");
    await ui.see("Already in");
    assert.equal(ui.app.sessionId, ui.sessionId);
  },
  new: async (ui) => {
    await ui.until(() => ui.app.sessionId !== ui.sessionId, "New chat becomes active");
    await ui.until(
      () => !ui.frame().includes("One line reply.") && !ui.frame().includes("Transcript line"),
      "Old transcript is cleared",
    );
    assert.equal((await ui.host.nyte.sessions.list()).items.length, 2);
  },
  compact: async (ui) => {
    await ui.see("Compacted");
    assert.ok(
      (await ui.host.sessionCommits(ui.sessionId)).some(
        (entry) => entry.commit.body.kind === "checkpoint",
      ),
    );
  },
  usage: async (ui) => {
    await ui.see("workspace · 1 chat");
    await ui.see(ui.size === "short" ? "15" : "90");
  },
  tasks: async (ui) => {
    await ui.see("Tasks");
    await dismiss(ui);
  },
  tree: async (ui) => {
    await ui.see("seed");
    await ui.until(() => ui.shell.selecting, "Tree is open");
    await dismiss(ui);
  },
  edit: async (ui) => {
    await ui.until(() => ui.shell.selecting, "User-message tree is open");
    await ui.see("seed");
    await ui.key("ARROW_UP");
    await ui.key("RETURN");
    await ui.see("Summarize the branch");
    await ui.key("RETURN");
    await ui.until(
      () => ui.shell.input.plainText.startsWith("seed"),
      "Selected user message returns to composer",
    );
    await ui.see("Message moved back");
  },
  plugins: async (ui) => {
    await ui.see("qa-fixture");
    await ui.see("/qa-command");
  },
  reload: async (ui) => {
    await ui.see("Reloaded");
    assert.ok(
      (await ui.host.nyte.plugins.resources.list({ sessionId: ui.sessionId })).some(
        (skill) => skill.name === "qa-skill",
      ),
    );
  },
  update: async (ui) => {
    await ui.see("running from source");
  },
  skills: async (ui) => {
    await ui.see("Skills");
    await ui.see("qa-skill");
    await ui.key("RETURN");
    await ui.until(
      () => ui.shell.input.plainText === "/qa-skill ",
      "Skill selection prefills the composer",
    );
  },
};

const shortcuts: Record<ChatCommand, Check> = {
  "chat.interrupt": async (ui) => {
    ui.hold();
    await ui.type("hold the reply");
    await ui.key("RETURN");
    await ui.see("Waiting for QA");
    await ui.shortcut("chat.interrupt");
    await ui.until(
      async () =>
        (await ui.host.nyte.runs.current({ sessionId: ui.sessionId }))?.phase.kind === "aborted",
      "Escape aborts the real run",
    );
  },
  "chat.scroll.page.up": async (ui) => {
    const before = ui.shell.scroll.scrollTop;
    await ui.shortcut("chat.scroll.page.up");
    await ui.until(
      () =>
        ui.size === "short" ? ui.shell.scroll.scrollTop === 0 : ui.shell.scroll.scrollTop < before,
      "Page up scrolls long transcripts and preserves short ones",
    );
  },
  "chat.scroll.page.down": async (ui) => {
    await ui.shortcut("chat.scroll.page.up");
    const before = ui.shell.scroll.scrollTop;
    await ui.shortcut("chat.scroll.page.down");
    await ui.until(
      () =>
        ui.size === "short" ? ui.shell.scroll.scrollTop === 0 : ui.shell.scroll.scrollTop > before,
      "Page down returns toward transcript end",
    );
  },
  "chat.message.previous": async (ui) => {
    const before = ui.shell.scroll.scrollTop;
    await ui.shortcut("chat.message.previous");
    await ui.until(
      () =>
        ui.size === "short" ? ui.shell.scroll.scrollTop === 0 : ui.shell.scroll.scrollTop < before,
      "Previous message moves to a turn boundary",
    );
  },
  "chat.message.next": async (ui) => {
    await ui.shortcut("chat.message.previous");
    await ui.shortcut("chat.message.previous");
    const before = ui.shell.scroll.scrollTop;
    await ui.shortcut("chat.message.next");
    await ui.until(
      () =>
        ui.size === "short" ? ui.shell.scroll.scrollTop === 0 : ui.shell.scroll.scrollTop > before,
      "Next message moves toward the following turn",
    );
  },
  "chat.thinking.cycle": async (ui) => {
    await ui.shortcut("chat.thinking.cycle");
    await ui.until(
      async () =>
        (await ui.host.nyte.sessions.snapshot({ sessionId: ui.sessionId }))?.session.config
          .thinkingLevel !== undefined,
      "Thinking cycle updates durable config",
    );
  },
  "chat.model.next": async (ui) => {
    await ui.shortcut("chat.model.next");
    await modelChanged(ui);
  },
  "chat.model.previous": async (ui) => {
    await ui.shortcut("chat.model.previous");
    await modelChanged(ui);
  },
  "chat.editor.open": async (ui) => {
    await ui.type("original draft");
    await ui.shortcut("chat.editor.open");
    await ui.until(
      () => ui.shell.input.plainText === "original draft edited by QA",
      "Real editor subprocess returns edited draft",
    );
  },
  "chat.attachment.open": async (ui) => {
    const text = Array.from({ length: 12 }, (_, index) => `pasted line ${index + 1}`).join("\n");
    await ui.keys.pasteBracketedText(text);
    await ui.until(() => ui.shell.input.plainText.includes("[Paste #1"), "Long paste collapses");
    ui.shell.input.cursorOffset = 0;
    await ui.shortcut("chat.attachment.open");
    await ui.until(
      () => ui.shell.input.plainText.includes(text),
      "Attachment shortcut expands original text",
    );
  },
  "chat.clipboard.paste": async (ui) => {
    await ui.shortcut("chat.clipboard.paste");
    await ui.until(
      () => ui.shell.input.plainText === "clipboard QA",
      "Clipboard text reaches the composer",
    );
    await ui.key("RETURN");
    await ui.see("QA reply: clipboard QA");
  },
  "chat.queue.open": async (ui) => {
    await queue(ui);
    await ui.shortcut("chat.queue.open");
    await ui.see("Queued messages");
    await ui.see("queued QA message");
    await dismiss(ui);
  },
  "chat.queue.submit": async (ui) => {
    await queue(ui);
    const pending = await ui.host.nyte.messages.pending({ sessionId: ui.sessionId });
    assert.equal(pending[0]?.lane, "queue");
    await ui.see("queued QA message");
  },
  "chat.queue.edit": async (ui) => {
    await queue(ui);
    await ui.type("unsent draft");
    await ui.shortcut("chat.queue.open");
    await ui.see("Queued messages");
    await ui.shortcut("chat.queue.edit");
    await ui.until(
      () => ui.shell.input.plainText === "queued QA message",
      "Edit loads the queued message",
    );
    await ui.type(" edited");
    await ui.key("RETURN");
    await ui.until(
      () => ui.shell.input.plainText === "unsent draft",
      "Saving restores the original composer draft",
    );
    const pending = await ui.host.nyte.messages.pending({ sessionId: ui.sessionId });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.content, "queued QA message edited");
  },
  "chat.queue.delete": async (ui) => {
    await queue(ui);
    await ui.shortcut("chat.queue.open");
    await ui.see("Queued messages");
    await ui.shortcut("chat.queue.delete");
    await ui.until(
      async () => (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length === 0,
      "Delete removes the queued message",
    );
  },
  "chat.queue.up": async (ui) => {
    await queue(ui);
    await ui.type("second queued message");
    await ui.shortcut("chat.queue.submit");
    await ui.until(
      async () => (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length === 2,
      "Both messages are queued",
    );
    await ui.shortcut("chat.queue.open");
    await ui.see("Queued messages");
    await ui.key("ARROW_DOWN");
    await ui.shortcut("chat.queue.up");
    await ui.until(
      async () =>
        (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId }))[0]?.content ===
        "second queued message",
      "Move up changes durable delivery order",
    );
    await dismiss(ui);
  },
  "chat.queue.down": async (ui) => {
    await queue(ui);
    await ui.type("second queued message");
    await ui.shortcut("chat.queue.submit");
    await ui.until(
      async () => (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length === 2,
      "Both messages are queued",
    );
    await ui.shortcut("chat.queue.open");
    await ui.see("Queued messages");
    await ui.shortcut("chat.queue.down");
    await ui.until(
      async () =>
        (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId }))[0]?.content ===
        "second queued message",
      "Move down changes durable delivery order",
    );
    await dismiss(ui);
  },
  "chat.task.stop": async (ui) => {
    await ui.type("run slow QA task");
    await ui.key("RETURN");
    await ui.see("QA task started");
    await ui.command("tasks");
    await ui.see("Tasks");
    await ui.shortcut("chat.task.stop");
    await ui.until(
      async () =>
        (await ui.host.nyte.runs.current({ sessionId: ui.sessionId }))?.phase.kind === "aborted",
      "Task shortcut stops the owning run",
    );
  },
  "selection.copy": async (ui) => {
    await ui.type("selected draft");
    ui.shell.input.selectAll();
    await ui.shortcut("selection.copy");
    await ui.until(() => ui.copies.at(-1) === "selected draft", "Keyboard selection copies");
    assert.equal(ui.shell.input.plainText, "selected draft");
  },
  "selection.clear": async (ui) => {
    await ui.type("selected draft");
    ui.shell.input.selectAll();
    await ui.shortcut("selection.clear");
    assert.equal(ui.shell.input.hasSelection(), false);
    assert.equal(ui.shell.input.plainText, "selected draft");
  },
  "chat.tools.toggle": async (ui) => {
    await ui.type("run QA task");
    await ui.key("RETURN");
    await ui.see("QA tool finished");
    await ui.shortcut("chat.tools.toggle");
    await ui.see("Tool output expanded");
    await ui.see("QA task output 4");
    await ui.shortcut("chat.tools.toggle");
    await ui.see("Tool output collapsed");
    await ui.until(
      () => !ui.frame().includes("QA task output 4"),
      "Collapsed output hides middle lines",
    );
  },
  "chat.skills.open": async (ui) => {
    await ui.shortcut("chat.skills.open");
    await builtins.skills(ui);
  },
  "chat.commands.open": async (ui) => {
    await ui.shortcut("chat.commands.open");
    await builtins.help(ui);
  },
  "chat.history.previous": async (ui) => {
    await ui.shortcut("chat.history.previous");
    assert.equal(ui.shell.input.plainText, ui.size === "short" ? "seed 1" : "seed 6");
  },
  "chat.history.next": async (ui) => {
    await ui.shortcut("chat.history.previous");
    await ui.shortcut("chat.history.next");
    await ui.shortcut("chat.history.next");
    assert.equal(ui.shell.input.plainText, "");
  },
};

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGPImPj/Pwgz/N+Q8R+EAWn6DBvtR6QlAAAAAElFTkSuQmCC",
  "base64",
);

function descendants(node: Renderable): Renderable[] {
  return [node, ...node.getChildren().flatMap(descendants)];
}

const portScenarios: Scenario[] = [
  {
    name: "ports.queue-autocomplete",
    run: async (ui) => {
      await queue(ui);
      await ui.type("/qa-s");
      await ui.see("/qa-skill");
      await ui.shortcut("chat.queue.submit");
      await ui.until(
        async () =>
          (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).some(
            (item) =>
              item.lane === "queue" && contentText(item.content).includes('<skill name="qa-skill"'),
          ),
        "Queue shortcut completes and expands the selected skill",
      );
    },
  },
  {
    name: "ports.paste-submit",
    run: async (ui) => {
      const clipboard = Promise.withResolvers<ClipboardRepresentation>();
      ui.setClipboard(clipboard.promise);
      await ui.type("before ");
      await ui.shortcut("chat.clipboard.paste");
      await ui.key("RETURN");
      assert.equal(
        ui.requests.some((text) => text === "before"),
        false,
      );
      clipboard.resolve({ mimeType: "text/plain", bytes: new TextEncoder().encode("after") });
      await ui.until(
        () => ui.requests.includes("before after"),
        "Submit waits for the active clipboard paste",
      );
    },
  },
  {
    name: "ports.plugin-hot-reload",
    run: async (ui) => {
      const directory = join(ui.host.cwd, ".nyte", "plugins", "tui", "qa-live");
      const helpers = join(ui.host.cwd, "helpers");
      const helper = join(helpers, "message.ts");
      const entrypoint = join(directory, "index.ts");
      const log = join(ui.host.cwd, "reload.log");
      await mkdir(directory, { recursive: true });
      await mkdir(helpers);
      await writeFile(helper, 'export const message = "Live plugin first";\n');
      const source = `import { define } from "@nyte-ai/plugin";
import { TextRenderable } from "@opentui/core";
import { appendFileSync } from "node:fs";
import { message } from "../../../../helpers/message.ts";
export default define({ id: "qa-live", setup(context) {
  const [read, write] = context.storage.memory("visits", { initial: 0 });
  const count = read();
  if (typeof count !== "number") throw new Error("Invalid visits");
  write(count + 1);
  appendFileSync(${JSON.stringify(log)}, "setup\\n");
  context.ui.slot("session.composer.top", () => new TextRenderable(context.renderer, { content: message + " " + (count + 1), fg: context.theme.fg, height: 1 }));
  return () => { appendFileSync(${JSON.stringify(log)}, "cleanup\\n"); };
} });`;
      await writeFile(entrypoint, source);
      await ui.see("Live plugin first 1");
      await writeFile(helper, 'export const message = "Live plugin second";\n');
      await ui.see("Live plugin second 2");
      assert.equal(await readFile(log, "utf8"), "setup\nsetup\ncleanup\n");
      await writeFile(helper, 'export const message = "Live plugin second";\n');
      await ui.command("reload");
      await ui.see("Reloaded");
      assert.equal(
        await readFile(log, "utf8"),
        "setup\nsetup\ncleanup\n",
        "Identical source does not repeat setup",
      );
      await writeFile(helper, "export const message = ;\n");
      await ui.see("Plugin");
      await ui.see("Live plugin second 2");
      await writeFile(helper, 'export const message = "Live plugin repaired";\n');
      await ui.see("Live plugin repaired 3");
      await ui.resize(60, 24);
      await ui.see("Live plugin repaired 3");
      assert.ok(ui.shell.input.y < 24);
      await ui.command("plugins");
      await ui.see("qa-live TUI");
      await writeFile(
        entrypoint,
        source.replace("setup(context) {", 'setup(context) { throw new Error("setup failed");'),
      );
      await ui.see("setup failed");
      await ui.see("Live plugin repaired 3");
      await ui.command("reload");
      await ui.see("Reloaded");
      assert.equal(
        (await readFile(log, "utf8")).split("setup\n").length - 1,
        3,
        "Broken setup does not repeat on an unchanged reload",
      );
      for (const definition of [
        "null",
        "42",
        "{}",
        '{ id: "", setup() {} }',
        "{ id: 42, setup() {} }",
        '{ id: "invalid", setup: "not callable" }',
      ]) {
        await writeFile(entrypoint, `export default ${definition};`);
        await ui.command("reload");
        await ui.see("Reloaded");
        await ui.see("Live plugin repaired 3");
      }
      await writeFile(
        entrypoint,
        source.replace("setup(context) {", "setup(context) { return 42;"),
      );
      await ui.see("cleanup function or undefined");
      await ui.see("Live plugin repaired 3");
      await writeFile(entrypoint, source);
      await ui.see("Live plugin repaired 4");
      await writeFile(
        entrypoint,
        source
          .replace(
            "export default define",
            'class BrokenText extends TextRenderable { protected override renderSelf() { throw new Error("render failed"); } }\nexport default define',
          )
          .replace("new TextRenderable(context.renderer", "new BrokenText(context.renderer"),
      );
      await ui.see("render failed");
      assert.equal(ui.renderer.isDestroyed, false);
      await writeFile(entrypoint, source);
      await ui.see("Live plugin repaired 6");
      await ui.command("theme light");
      await ui.see("Theme: light");
      await ui.see("Live plugin repaired 6");
      await unlink(entrypoint);
      await ui.until(
        () => !ui.frame().includes("Live plugin repaired"),
        "Deleting a plugin removes its slot",
      );
      await writeFile(entrypoint, source);
      await ui.see("Live plugin repaired 7");
      await writeFile(helper, 'export const nextMessage = "Live plugin renamed";\n');
      await writeFile(
        entrypoint,
        source
          .replace("import { message }", "import { nextMessage }")
          .replace("content: message +", "content: nextMessage +"),
      );
      await ui.see("Live plugin renamed 8");
    },
  },
  {
    name: "ports.queue-drag",
    run: async (ui) => {
      await queue(ui);
      await ui.type("second queued message");
      await ui.shortcut("chat.queue.submit");
      await ui.until(
        async () => (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length === 2,
        "Two queued messages are visible",
      );
      await ui.see("second queued message");
      const rows = ui.shell.pendingGutter.container.getChildren();
      const first = rows[0];
      const second = rows[1];
      assert.ok(first && second);
      await ui.mouse.drag(second.x + 1, second.y, first.x + 1, first.y);
      await ui.until(
        async () =>
          (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId }))[0]?.content ===
          "second queued message",
        "Dragging changes durable queue order",
      );
    },
  },
  {
    name: "ports.follow-up-preference",
    run: async (ui) => {
      await ui.command("follow-up queue");
      await ui.until(
        async () => (await ui.settingsStore.read(ui.host.cwd)).followUp === "queue",
        "Follow-up setting persists",
      );
      ui.hold();
      await ui.type("hold the reply");
      await ui.key("RETURN");
      await ui.see("Waiting for QA");
      await ui.type("default queued follow-up");
      await ui.key("RETURN");
      await ui.until(
        async () =>
          (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId }))[0]?.lane === "queue",
        "Enter queues when configured",
      );
      await ui.type("alternate steer");
      await ui.shortcut("chat.queue.submit");
      await ui.until(
        async () =>
          (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).some(
            (item) => item.lane === "steer",
          ),
        "Alternate shortcut steers",
      );
    },
  },
  {
    name: "ports.copy-on-select",
    run: async (ui) => {
      await ui.command("copy-on-select on");
      await ui.until(
        async () => (await ui.settingsStore.read(ui.host.cwd)).copyOnSelect,
        "Copy-on-select setting persists",
      );
      await ui.type("alpha beta gamma");
      await ui.mouse.doubleClick(ui.shell.input.x + 7, ui.shell.input.y);
      await ui.until(() => ui.copies.at(-1) === "beta", "Word copies on release");
      await ui.mouse.click(ui.shell.input.x + 7, ui.shell.input.y);
      await ui.until(() => ui.copies.at(-1) === "alpha beta gamma", "Triple-click copies the line");
    },
  },
  {
    name: "ports.paste-expand-undo",
    run: async (ui) => {
      const paste = Array.from({ length: 12 }, (_, index) => `original ${index}`).join("\n");
      await ui.type("日本語 ");
      await ui.keys.pasteBracketedText(paste);
      await ui.until(() => ui.shell.input.plainText.includes("[Paste #1"), "Paste is collapsed");
      const draft = ui.shell.input.plainText;
      await ui.keys.pasteBracketedText(paste);
      await ui.until(
        () => ui.shell.input.plainText.includes(paste),
        "Repeat paste expands rather than duplicating",
      );
      assert.equal(ui.shell.input.plainText, `日本語 ${paste} `);
      ui.shell.input.undo();
      await ui.until(() => ui.shell.input.plainText === draft, "Expansion can be undone");
      const start = cellOffset(draft, draft.indexOf("[Paste"));
      ui.shell.input.cursorOffset = start;
      await ui.shortcut("chat.attachment.open");
      await ui.until(
        () => ui.shell.input.plainText.includes(paste),
        "Undo retains original attachment bytes",
      );
      await ui.resize(60, 24);
      await ui.key("RETURN");
      await ui.until(
        () => ui.requests.some((text) => text.includes(`日本語 ${paste}`)),
        "Expanded text is sent intact",
      );
    },
  },
  {
    name: "ports.paste-click-and-delete",
    run: async (ui) => {
      const paste = "line\n".repeat(10);
      await ui.keys.pasteBracketedText(paste);
      await ui.until(
        () => ui.shell.input.plainText.includes("[Paste #1"),
        "Paste marker is visible",
      );
      await ui.mouse.click(ui.shell.input.x + 3, ui.shell.input.y);
      await ui.until(() => ui.shell.input.plainText.includes(paste), "Click expands pasted text");
      ui.shell.input.undo();
      await ui.until(() => ui.shell.input.plainText.includes("[Paste #1"), "Undo restores marker");
      ui.shell.input.cursorOffset = ui.shell.input.plainText.indexOf("]") + 1;
      await ui.key("BACKSPACE");
      assert.equal(ui.shell.input.plainText, " ", "Backspace removes the whole marker");
      ui.shell.input.undo();
      await ui.until(
        () => ui.shell.input.plainText.includes("[Paste #1"),
        "Undo restores deleted marker",
      );
      await ui.key("RETURN");
      await ui.until(
        () => ui.requests.some((text) => text === paste),
        "Deleted-and-restored marker still expands on send",
      );
    },
  },
  {
    name: "ports.image-preview",
    run: async (ui) => {
      ui.setClipboard({ mimeType: "image/png", bytes: png });
      await ui.shortcut("chat.clipboard.paste");
      await ui.until(
        () => ui.shell.input.plainText === "[Image 1] ",
        "Clipboard image becomes an attachment",
      );
      await ui.shortcut("chat.clipboard.paste");
      await ui.until(
        () => ui.shell.input.plainText === "[Image 1] ",
        "Repeated image is deduplicated",
      );
      ui.shell.input.cursorOffset = 0;
      await ui.shortcut("chat.attachment.open");
      await ui.see("[Image 1] · click to close");
      await ui.until(
        () =>
          descendants(ui.shell.live).some(
            (node) => node instanceof ImageRenderable && node.image !== null,
          ),
        "Native composer image is decoded",
      );
      await ui.resize(60, 24);
      assert.ok(ui.shell.input.y < 24);
      await ui.key("RETURN");
      await ui.see("Image 1 (image/png)");
      const image = descendants(ui.shell.scroll).find((node) => node instanceof ImageRenderable);
      assert.ok(image instanceof ImageRenderable);
      const tag = descendants(ui.shell.scroll).find(
        (node) => node instanceof TextRenderable && node.plainText.includes("Image 1 (image/png)"),
      );
      assert.ok(tag);
      await ui.mouse.click(tag.x + 2, tag.y);
      await ui.until(
        () => image.visible && image.image !== null,
        "Transcript image opens on click",
      );
      await ui.mouse.click(tag.x + 2, tag.y);
      assert.equal(image.visible, false);
    },
  },
  {
    name: "ports.selection-copy",
    run: async (ui) => {
      await ui.type("alpha beta gamma");
      const input = ui.shell.input;
      await ui.mouse.doubleClick(input.x + 7, input.y);
      await ui.key("c", { ctrl: true });
      await ui.until(() => ui.copies.at(-1) === "beta", "Double-clicked word is copied");
      assert.equal(input.plainText, "alpha beta gamma");
      assert.equal(ui.didQuit(), false);
      await ui.mouse.click(input.x + 7, input.y);
      await ui.key("c", { ctrl: true });
      await ui.until(
        () => ui.copies.at(-1) === "alpha beta gamma",
        "Third click still selects the line after copying",
      );
      await ui.key("ESCAPE");
      assert.equal(input.hasSelection(), false);
      assert.equal(input.plainText, "alpha beta gamma");
    },
  },
  {
    name: "ports.table-selection",
    run: async (ui) => {
      await ui.type("table\n\n| Animal | Count |\n| --- | --- |\n| Otter | 12 |\n| Owl | 3 |");
      await ui.key("RETURN");
      await ui.until(
        () => descendants(ui.shell.scroll).some((node) => node instanceof TextTableRenderable),
        "Markdown table is rendered",
      );
      for (const width of [60, 120]) {
        await ui.resize(width, 30);
        const table = descendants(ui.shell.scroll).find(
          (node) => node instanceof TextTableRenderable,
        );
        assert.ok(table instanceof TextTableRenderable);
        await ui.mouse.drag(table.x + 1, table.y + 1, table.x + 5, table.y + 2);
        await ui.key("c", { ctrl: true });
        await ui.until(
          () => ui.copies.at(-1)?.includes("Otter") === true,
          "Table column text copies",
        );
        assert.ok(ui.copies.at(-1)?.includes("Owl"));
        assert.equal(
          ui.copies.at(-1)?.includes("12"),
          false,
          "Column selection excludes the neighboring column",
        );
        await ui.key("ESCAPE");
      }
    },
  },
  {
    name: "ports.mermaid",
    run: async (ui) => {
      await ui.type(
        "diagram\n\n```mermaid\nflowchart LR\n  A[Draft] --> B[Queue] --> C[Send]\n```",
      );
      await ui.key("RETURN");
      await ui.see("mermaid · click for source");
      const toggle = descendants(ui.shell.scroll).find(
        (node) => node instanceof TextRenderable && node.plainText === "mermaid · click for source",
      );
      assert.ok(toggle);
      await ui.resize(60, 24);
      await ui.mouse.click(toggle.x + 2, toggle.y);
      await ui.see("mermaid · click for diagram");
      await ui.see("flowchart LR");
      await ui.mouse.click(toggle.x + 2, toggle.y);
      await ui.see("mermaid · click for source");
    },
  },
];

export const scenarios: Scenario[] = [
  ...portScenarios,
  ...[false, true].map((exitWhileLoading): Scenario => ({
    name: exitWhileLoading ? "startup.exit" : "startup.first-paint",
    run: async (ui) => {
      ui.app.dispose();
      ui.renderer.root.remove(ui.shell.root);
      ui.shell.root.destroyRecursively();
      const cwd = process.cwd();
      const directory = join(ui.host.cwd, ".nyte", "plugins");
      const entered = join(ui.host.cwd, "boot-entered");
      const release = join(ui.host.cwd, "boot-release");
      const released = join(ui.host.cwd, "boot-released");
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "boot.ts"),
        `
import { watch, existsSync, writeFileSync } from "node:fs";
await new Promise(resolve => {
  const watcher = watch(${JSON.stringify(ui.host.cwd)}, () => {
    if (!existsSync(${JSON.stringify(release)})) return;
    watcher.close();
    resolve();
  });
  writeFileSync(${JSON.stringify(entered)}, "entered");
});
writeFileSync(${JSON.stringify(released)}, "released");
export default { id: "boot", session() {} };
`,
      );
      await createWorkspaceTrustStore().trust(ui.host.cwd);
      process.chdir(ui.host.cwd);
      const running = runTui(parseFlags(["--provider", "opencode"]), ui.renderer);
      try {
        // Assert the real launcher mounts chrome synchronously, before trust or plugin I/O resolves.
        const input = ui.renderer.root.findDescendantById("input");
        const powerline = ui.renderer.root.findDescendantById("powerline");
        assert.ok(input instanceof TextareaRenderable);
        assert.ok(powerline instanceof TextRenderable);
        assert.ok(powerline.plainText.includes("model loading"));
        await ui.type("draft during startup");
        await ui.until(() => existsSync(entered), "Project plugin is blocked during startup");
        await ui.see("Loading workspace plugins");
        await ui.see("draft during startup");
        assert.equal(input.plainText, "draft during startup");
        for (const width of [60, 120]) {
          await ui.resize(width, 24);
          assert.ok(input.y < 24);
          assert.ok(powerline.y < 24);
          assert.ok(powerline.plainText.includes("loading"));
          await ui.see("draft during startup");
        }
        if (exitWhileLoading) {
          await ui.key("c", { ctrl: true });
          assert.deepEqual(await running, { kind: "signal", signal: "SIGINT" });
          assert.equal(existsSync(release), false, "Exit does not wait for plugin loading");
          return;
        }
        await ui.key("RETURN");
        assert.equal(input.plainText, "draft during startup");
        await writeFile(release, "release");
        await ui.until(
          () => ui.renderer.root.findDescendantById("session-loading")?.visible === false,
          "Session finishes loading",
        );
        assert.equal(input.plainText, "draft during startup", "Hydration keeps the early draft");
        input.clear();
        await ui.type("/quit");
        await ui.key("RETURN");
        assert.deepEqual(await running, { kind: "quit" });
      } finally {
        process.chdir(cwd);
        await writeFile(release, "release");
        ui.renderer.destroy();
        await running;
        await ui.until(() => existsSync(released), "Blocked plugin releases its watcher");
      }
    },
  })),
  ...SLASH_COMMANDS.flatMap((command: SlashCommand) =>
    [command.name, ...(command.aliases ?? [])].map((name) => ({
      name: `/${name}`,
      run: async (ui: Fixture) => {
        const entry = SLASH_COMMANDS.find((item) => item.name === command.name);
        assert.ok(entry);
        await ui.command(name);
        await builtins[entry.name](ui);
      },
    })),
  ),
  ...Object.entries(shortcuts).map(([name, run]) => ({ name, run })),
  ...[
    { name: "model", title: "QA Second" },
    { name: "effort", title: "Thinking level" },
    { name: "theme", title: "Theme" },
    { name: "auto-update", title: "Auto-update" },
    { name: "qa-setting", title: "QA setting" },
  ].map((setting) => ({
    name: `/${setting.name}`,
    run: async (ui: Fixture) => {
      await ui.command(setting.name);
      await ui.see(setting.title);
      await dismiss(ui);
    },
  })),
  {
    name: "/theme light",
    run: async (ui) => {
      await ui.command("theme light");
      await ui.see("Theme: light");
      assert.equal((await ui.settingsStore.read(ui.host.cwd)).theme, "light");
    },
  },
  {
    name: "/effort high",
    run: async (ui) => {
      await ui.command("effort high");
      await ui.see("Thinking level: high");
      await ui.until(
        async () =>
          (await ui.host.nyte.sessions.snapshot({ sessionId: ui.sessionId }))?.session.config
            .thinkingLevel === "high",
        "Thinking choice reaches durable session configuration",
      );
    },
  },
  {
    name: "/model qa-second",
    run: async (ui) => {
      await ui.command("model qa-second");
      await modelChanged(ui);
    },
  },
  {
    name: "/auto-update on",
    run: async (ui) => {
      await ui.command("auto-update on");
      await ui.until(
        async () => (await ui.settingsStore.read(ui.host.cwd)).autoUpdate,
        "Auto-update setting persists locally",
      );
    },
  },
  {
    name: "/qa-setting on",
    run: async (ui) => {
      await ui.command("qa-setting on");
      await ui.until(
        async () =>
          (await ui.host.nyte.plugins.settings.list({ sessionId: ui.sessionId })).some(
            (setting) => setting.id === "qa-setting" && setting.current === "on",
          ),
        "Plugin setting is applied",
      );
    },
  },
  {
    name: "/qa-command",
    run: async (ui) => {
      await ui.command("qa-command hello");
      await ui.see("QA command: hello");
    },
  },
  {
    name: "/qa-skill",
    run: async (ui) => {
      await ui.command("qa-skill");
      if (ui.shell.input.plainText !== "") await ui.key("RETURN");
      await ui.until(
        () => ui.requests.some((text) => text.includes('<skill name="qa-skill"')),
        "Skill instructions reach the provider",
      );
    },
  },
  {
    name: "composer.send",
    run: async (ui) => {
      await ui.type("hello QA");
      await ui.key("RETURN");
      await ui.see("QA reply: hello QA");
    },
  },
  {
    name: "composer.paste",
    run: async (ui) => {
      await ui.keys.pasteBracketedText("pasted QA");
      await ui.until(
        () => ui.shell.input.plainText === "pasted QA",
        "Bracketed paste reaches composer",
      );
      await ui.key("RETURN");
      await ui.see("QA reply: pasted QA");
    },
  },
  {
    name: "composer.quit",
    run: async (ui) => {
      await ui.type("draft");
      await ui.key("c", { ctrl: true });
      assert.equal(ui.didQuit(), false);
      assert.equal(ui.shell.input.plainText, "");
      await ui.key("c", { ctrl: true });
      assert.equal(ui.didQuit(), true);
    },
  },
  {
    name: "queue.edit",
    run: async (ui) => {
      await queue(ui);
      await ui.shortcut("chat.queue.open");
      await ui.see("Queued messages");
      await ui.key("e", { ctrl: true });
      await ui.until(
        () => ui.shell.input.plainText === "queued QA message",
        "Queue edit restores composer",
      );
      assert.equal((await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length, 1);
      await ui.key("ESCAPE");
      assert.equal(ui.shell.input.plainText, "");
    },
  },
  {
    name: "queue.delete",
    run: async (ui) => {
      await queue(ui);
      await ui.shortcut("chat.queue.open");
      await ui.see("Queued messages");
      await ui.key("d", { ctrl: true });
      await ui.see("Removed from the queue");
      assert.equal((await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).length, 0);
    },
  },
  {
    name: "queue.send-now",
    run: async (ui) => {
      await queue(ui);
      await ui.shortcut("chat.queue.open");
      await ui.see("Queued messages");
      await ui.key("RETURN");
      await ui.until(
        async () =>
          (await ui.host.nyte.messages.pending({ sessionId: ui.sessionId })).some(
            (item) => item.lane === "steer",
          ),
        "Send now promotes the queued message to steer",
      );
      ui.release();
      await ui.see("QA reply: queued QA message");
    },
  },
  {
    name: "palette.execute",
    run: async (ui) => {
      await ui.shortcut("chat.commands.open");
      await ui.see("Commands");
      await ui.type("plugins");
      await ui.key("RETURN");
      await ui.see("qa-fixture");
    },
  },
  {
    name: "settings.select",
    run: async (ui) => {
      await ui.command("settings");
      await ui.see("Settings");
      await ui.type("Theme");
      await ui.key("RETURN");
      await ui.see("Follow the terminal");
      await ui.key("ARROW_DOWN");
      await ui.key("RETURN");
      await ui.until(
        async () => (await ui.settingsStore.read(ui.host.cwd)).theme === "light",
        "Settings picker persists light theme",
      );
      await ui.see("Settings");
      await dismiss(ui);
    },
  },
  {
    name: "resume.switch",
    run: async (ui) => {
      const other = await ui.host.nyte.sessions.create();
      await ui.host.nyte.messages.send({
        sessionId: other.sessionId,
        content: "other conversation",
      });
      await ui.host.nyte.runs.wait({ sessionId: other.sessionId });
      await ui.host.nyte.sessions.rename({ sessionId: other.sessionId, name: "Other QA chat" });
      await ui.command("resume");
      await ui.see("Resume chat");
      await ui.type("Other QA chat");
      await ui.key("RETURN");
      await ui.until(
        () => ui.app.sessionId === other.sessionId,
        "Resume switches the followed session",
      );
      await ui.see("QA reply: other conversation");
    },
  },
  {
    name: "tasks.inspect",
    run: async (ui) => {
      await ui.type("run QA task");
      await ui.key("RETURN");
      await ui.see("QA tool finished");
      await ui.command("tasks");
      await ui.see("Tasks");
      await ui.key("RETURN");
      await ui.see("QA task output");
      await ui.pause();
      await ui.key("ESCAPE");
      await ui.see("Tasks");
      await dismiss(ui);
    },
  },
  {
    name: "question.answer",
    run: async (ui) => {
      await ui.type("ask QA question");
      await ui.key("RETURN");
      await ui.see("QA question");
      await ui.see("First choice");
      await ui.key("ARROW_DOWN");
      await ui.key("RETURN");
      await ui.see("QA tool finished");
      assert.equal(
        (await ui.host.nyte.runs.current({ sessionId: ui.sessionId }))?.phase.kind,
        "done",
      );
      assert.ok(
        (await ui.host.sessionCommits(ui.sessionId)).some((entry) => {
          const body = entry.commit.body;
          return (
            body.kind === "message" &&
            body.message.role === "toolResult" &&
            contentText(body.message.content) === "Second choice"
          );
        }),
        "The selected answer is persisted in the actual tool result",
      );
    },
  },
  {
    name: "layout.resize",
    run: async (ui) => {
      for (const width of [60, 120]) {
        await ui.resize(width, 24);
        await ui.see("qa-model");
        assert.equal(ui.renderer.width, width);
        assert.equal(ui.renderer.height, 24);
        assert.ok(ui.shell.input.screenY < 24, "Composer remains in the viewport");
      }
    },
  },
];

assert.deepEqual(Object.keys(shortcuts).toSorted(), Object.keys(CHAT_KEYBINDS).toSorted());
