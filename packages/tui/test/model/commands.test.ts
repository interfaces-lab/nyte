import { describe, expect, test } from "bun:test";
import type { CommandInfo, SessionView } from "@nyte-ai/sdk";
import { SLASH_COMMANDS } from "../../src/lib/slash.ts";
import { liveChoices } from "../../src/model/choices.ts";
import { commandRegistry, resolveCommand, slashNamespace } from "../../src/model/commands.ts";
import type { Intent } from "../../src/model/msg.ts";
import { buildView } from "../fixture/view.ts";
import { play, ready, S1, typed } from "./support.ts";

function command(name: string, side: CommandInfo["side"]): CommandInfo {
  return {
    name,
    owner: "plugin",
    side,
    title: name,
    description: `${name} command`,
    takesText: false,
    completes: false,
  };
}

const base = buildView((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

const view: SessionView = {
  ...base,
  catalog: {
    ...base.catalog,
    commands: [command("qa-probe", "core"), command("local", "client"), command("help", "core")],
    skills: [{ name: "review", owner: "w", description: "Review code", location: "/s/review.md" }],
    settings: [
      {
        id: "fast-mode",
        owner: "plugin",
        scope: "session",
        label: "Fast mode",
        schema: {},
        choices: [
          { value: true, label: "on", badge: "fast" },
          { value: false, label: "off" },
        ],
        value: false,
        from: "default",
      },
    ],
  },
};

function run(name: string, argument = ""): Intent | null {
  return resolveCommand(ready(view), name)?.run(argument) ?? null;
}

describe("built-in commands", () => {
  test.each([
    ["help", "", { kind: "open", dialog: { kind: "list", purpose: { kind: "palette" } } }],
    ["quit", "", { kind: "quit" }],
    [
      "resume",
      "",
      { kind: "open", dialog: { kind: "list", purpose: { kind: "resume", sessions: [] } } },
    ],
    [
      "sessions",
      "",
      { kind: "open", dialog: { kind: "list", purpose: { kind: "resume", sessions: [] } } },
    ],
    [
      "continue",
      "",
      { kind: "open", dialog: { kind: "list", purpose: { kind: "resume", sessions: [] } } },
    ],
    ["new", "", { kind: "switch-session", session: "new", announce: false }],
    ["cd", "~/src", { kind: "change-directory", path: "~/src" }],
    [
      "settings",
      "",
      { kind: "open", dialog: { kind: "list", purpose: { kind: "settings", highlight: null } } },
    ],
    ["login", "", { kind: "open", dialog: { kind: "auth", mode: "login", provider: null } }],
    [
      "login",
      "openai",
      { kind: "open", dialog: { kind: "auth", mode: "login", provider: "openai" } },
    ],
    [
      "logout",
      "test",
      { kind: "open", dialog: { kind: "auth", mode: "logout", provider: "test" } },
    ],
    ["compact", "", { kind: "compact", instructions: null }],
    ["compact", "keep tests", { kind: "compact", instructions: "keep tests" }],
    ["usage", "", { kind: "open", dialog: { kind: "text", content: "usage" } }],
    [
      "tasks",
      "",
      { kind: "open", dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } } },
    ],
    ["tree", "", { kind: "open", dialog: { kind: "tree", filter: "default" } }],
    ["edit", "", { kind: "open", dialog: { kind: "tree", filter: "users" } }],
    ["plugins", "", { kind: "open", dialog: { kind: "text", content: "plugins" } }],
    ["pr", "", { kind: "open", dialog: { kind: "text", content: "pull-request" } }],
    ["pr", "status", { kind: "open", dialog: { kind: "text", content: "pull-request" } }],
    ["reload", "", { kind: "reload" }],
    ["update", "", { kind: "update", version: null }],
    ["update", "1.2.3", { kind: "update", version: "1.2.3" }],
    ["skills", "", { kind: "open", dialog: { kind: "list", purpose: { kind: "skills" } } }],
  ] satisfies [string, string, Intent][])("/%s %s", (name, argument, intent) => {
    expect(run(name, argument)).toEqual(intent);
  });

  test("every built-in from lib/slash.ts is in the registry as a built-in", () => {
    const registry = commandRegistry(ready(view));

    for (const builtin of SLASH_COMMANDS)
      expect(registry.find((entry) => entry.name === builtin.name)?.source).toBe("builtin");
  });

  test("/cd without a path prefills instead of running", () => {
    expect(run("cd")).toBeNull();
  });

  test("a command that takes no argument refuses one", () => {
    expect(run("tree", "now")).toEqual({ kind: "refuse", reason: "/tree takes no argument" });
  });
});

describe("settings", () => {
  test("/model opens the picker; /model <id> applies it", () => {
    expect(run("model")).toEqual({ kind: "open", dialog: { kind: "model" } });
    expect(run("model", "other")).toEqual({
      kind: "configure",
      selection: { model: { provider: "test", id: "other" }, effort: "off", fast: false },
    });
  });

  test("/theme opens its choices, /theme light writes the setting, an unknown choice lists the valid ones", () => {
    expect(run("theme")).toEqual({
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "setting", key: "theme" } },
    });
    expect(run("theme", "light")).toEqual({ kind: "write-settings", patch: { theme: "light" } });
    expect(run("theme", "neon")).toEqual({
      kind: "refuse",
      reason: "Unknown Theme: neon. Choices: auto, dark, light",
    });
  });

  test("a plugin setting applies through its scope", () => {
    expect(run("fast-mode", "on")).toEqual({
      kind: "apply-setting",
      id: "fast-mode",
      label: "Fast mode",
      scope: "session",
      value: true,
    });
  });

  test("settings other than model and effort wait for the run", () => {
    const busy: SessionView = {
      ...view,
      execution: buildView((v) => v.turn("t1", (t) => t.user("x")).live()).execution,
    };

    const state = ready(busy);

    expect(resolveCommand(state, "follow-up")?.run("queue")).toMatchObject({ kind: "refuse" });
    expect(resolveCommand(state, "follow-up")?.run("")).toEqual({
      kind: "refuse",
      reason: "Wait for the current run before changing Follow-up behavior",
    });
    expect(resolveCommand(state, "model")?.run("")).toEqual({
      kind: "open",
      dialog: { kind: "model" },
    });
    expect(resolveCommand(state, "effort")?.run("high")).toEqual({
      kind: "configure",
      selection: { effort: "high" },
    });
  });
});

describe("plugins and skills", () => {
  test("a core-side plugin command runs through the session; a client-side one is sent as text", () => {
    expect(run("qa-probe", "x")).toEqual({
      kind: "plugin-command",
      name: "qa-probe",
      argument: "x",
    });
    expect(resolveCommand(ready(view), "local")?.prompt).toBe(true);
  });

  test("a skill stays a prompt", () => {
    expect(resolveCommand(ready(view), "review")).toMatchObject({ source: "skill", prompt: true });
  });

  test("first claim wins: a plugin cannot take a built-in's name", () => {
    expect(resolveCommand(ready(view), "help")?.source).toBe("builtin");
    expect(slashNamespace(ready(view)).filter((entry) => entry.name === "help")).toHaveLength(1);
  });
});

describe("palette", () => {
  test("lists the shortcuts report, every command but skills, then the active key actions", () => {
    const ids = (liveChoices(ready(view), { kind: "palette" }) ?? []).map((choice) => choice.id);

    expect(ids[0]).toBe("shortcuts");
    expect(ids).toContain("cmd:model");
    expect(ids).toContain("cmd:qa-probe");
    expect(ids).not.toContain("cmd:review");
    expect(ids).toContain("action:chat.thinking.cycle");
  });
});

describe("command text suggestions", () => {
  test("a command that suggests its text asks as it is typed, and Tab takes a suggestion", () => {
    const withKey: SessionView = {
      ...base,
      catalog: {
        ...base.catalog,
        commands: [
          {
            name: "websearch-key",
            owner: "web-search",
            side: "core",
            title: "Key",
            description: "Key",
            takesText: true,
            completes: true,
          },
        ],
      },
    };
    const asked = play(ready(withKey), typed("/websearch-key ta"));

    expect(asked.effects).toContainEqual({
      kind: "complete-command",
      session: S1,
      name: "websearch-key",
      prefix: "ta",
    });

    const filled = play(
      asked.state,
      {
        kind: "command-completed",
        name: "websearch-key",
        prefix: "ta",
        items: [{ value: "tavily ", label: "tavily" }],
      },
      { kind: "completion", action: { kind: "fill" } },
    );

    expect(filled.state.local.draft.text).toBe("/websearch-key tavily ");
  });
});
