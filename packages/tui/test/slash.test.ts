import assert from "node:assert/strict";
import { test } from "vitest";
import type { Skill } from "@nyte-ai/schema";
import {
  acceptSlashCommand,
  availableSlashCommands,
  expandInlineSkills,
  extractSkillInvocations,
  hasInlineSkills,
  parseComposerSubmission,
  slashCompletion,
} from "../src/slash.ts";

const skill: Skill = {
  name: "grilling",
  description: "Grill a plan",
  content: "Ask hard questions.",
  filePath: "/skills/grilling/SKILL.md",
};

test("a draft is a command only when a slash opens it with a legal name", () => {
  assert.deepEqual(parseComposerSubmission("  "), { kind: "empty" });
  assert.deepEqual(parseComposerSubmission("/name  my chat "), {
    kind: "command",
    command: { name: "name", argument: "my chat" },
  });
  assert.deepEqual(parseComposerSubmission("/Model"), {
    kind: "command",
    command: { name: "model", argument: "" },
  });
  assert.deepEqual(parseComposerSubmission("/etc/hosts is broken"), {
    kind: "prompt",
    text: "/etc/hosts is broken",
  });
  assert.deepEqual(parseComposerSubmission("/-x"), { kind: "prompt", text: "/-x" });
  assert.deepEqual(parseComposerSubmission("/new\nline"), { kind: "prompt", text: "/new\nline" });
});

test("completion ranks prefixes shortest first and never suggests inside an ordinary path", () => {
  const leading = slashCompletion("/re");
  assert.ok(leading !== undefined);
  assert.equal(leading.leading, true);
  assert.deepEqual(leading.commands.map((command) => command.name).slice(0, 2), [
    "reload",
    "resume",
  ]);
  const inline = slashCompletion("look at /re", undefined, "look at /re".length);
  assert.equal(inline?.leading, false);
  assert.equal(slashCompletion("src/tui.ts"), undefined);
  assert.equal(slashCompletion("/re done", undefined, 3)?.end, 3);
});

test("typing /log offers login and logout", () => {
  const matched = slashCompletion("/log");
  assert.deepEqual(
    matched?.commands.map((command) => command.name),
    ["login", "logout"],
  );
});

test("plugin commands and skills join the namespace without shadowing built-ins", () => {
  const commands = availableSlashCommands(
    new Map([
      ["deploy", { description: "Ship it" }],
      ["help", { description: "Not this one" }],
    ]),
    [
      { id: "model", label: "Model" },
      { id: "deploy", label: "Not this one either" },
    ],
    new Map([
      [skill.name, skill],
      ["usage", { ...skill, name: "usage" }],
    ]),
  );
  const byName = new Map(commands.map((command) => [command.name, command]));
  assert.equal(byName.get("help")?.description, "Browse commands");
  assert.equal(byName.get("usage")?.kind, "action");
  assert.deepEqual(byName.get("model"), { name: "model", description: "Model", kind: "setting" });
  assert.deepEqual(byName.get("deploy"), {
    name: "deploy",
    description: "Not this one either",
    kind: "setting",
  });
  assert.equal(byName.get("grilling")?.kind, "prompt");
  assert.equal(commands.length, byName.size);
});

test("enter runs actions and settings, leaves prompts in the composer, and tab always completes", () => {
  const quit = { name: "quit", description: "", kind: "action" } as const;
  const model = { name: "model", description: "", kind: "setting" } as const;
  const grill = { name: "grilling", description: "", kind: "prompt" } as const;
  assert.deepEqual(acceptSlashCommand(quit, "return"), { action: "execute" });
  assert.deepEqual(acceptSlashCommand(model, "return"), { action: "execute" });
  assert.deepEqual(acceptSlashCommand(grill, "return"), {
    action: "complete",
    token: "/grilling ",
  });
  assert.deepEqual(acceptSlashCommand(quit, "tab"), { action: "complete", token: "/quit " });
  assert.deepEqual(acceptSlashCommand(quit, "return", "with rest"), {
    action: "complete",
    token: "/quit",
  });
});

test("inline skills expand to their invocation and fold back to the token", () => {
  const skills = new Map([[skill.name, skill]]);
  assert.equal(hasInlineSkills("/grilling my plan", skills), false);
  assert.equal(hasInlineSkills("please /grilling my plan", skills), true);
  const expanded = expandInlineSkills("please /grilling my plan", skills);
  assert.ok(expanded.includes('<skill name="grilling"'));
  assert.ok(expanded.endsWith(" my plan"));
  const invocations = extractSkillInvocations(expanded);
  assert.deepEqual(
    invocations.map((invocation) => [invocation.name, invocation.path]),
    [["grilling", skill.filePath]],
  );
});
