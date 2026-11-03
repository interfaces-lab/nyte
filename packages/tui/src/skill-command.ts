import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { HostDescriptionType, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Compile } from "typebox/compile";
import { findRunningHost, hostFilePath } from "./host-endpoint.ts";
import { toJson } from "./json.ts";
import type { JsonObject } from "./json.ts";
import { VERSION } from "./version.ts";

interface Output {
  readonly write: (text: string) => void;
}

type Env = Readonly<Record<string, string | undefined>>;

type AgentName = "claude" | "codex";

interface Agent {
  readonly name: AgentName;
  readonly label: string;
  readonly home: string;
  readonly skill: string;
  readonly hooks: string;
}

type SkillState = "current" | "outdated" | "missing";

type HookState = "present" | "missing" | "unreadable";

const USAGE =
  "Usage: nyte skill <setup | remove> [--agent claude|codex|all] | status [--json] | hook. Run `nyte skill --help`.";

const STAMP = "nyte-skill-version:";

const SKILL_REVISION = 2;

const HOOK_COMMAND = "nyte skill hook";

const HOOK_BUDGET_MS = 2_000;

const descriptions = Compile(HostDescriptionType);

export async function skillCommand(input: {
  readonly args: readonly string[];
  readonly env: Env;
  readonly output: Output;
}): Promise<number> {
  const parsed = parseSkillArgs(input.args);
  const agents = findAgents(input.env);

  switch (parsed.command) {
    case "hook":
      input.output.write(await hookContext(input.env));

      return 0;
    case "status": {
      const report = await Promise.all(agents.map(statusReport));

      input.output.write(
        parsed.json
          ? `${JSON.stringify(Object.fromEntries(report.map((entry) => [entry.agent, entry.status])), null, 2)}\n`
          : statusLines(agents, report),
      );

      return 0;
    }

    case "setup":
    case "remove": {
      const chosen = agents.filter((agent) =>
        parsed.agent === "all" ? existsSync(agent.home) : agent.name === parsed.agent,
      );

      if (chosen.length === 0) {
        input.output.write(
          `Found no Claude Code or Codex config (${agents.map((agent) => agent.home).join(", ")}). Name one with --agent.\n`,
        );

        return 0;
      }

      for (const agent of chosen) {
        const lines =
          parsed.command === "setup" ? await setupAgent(agent) : await removeAgent(agent);

        input.output.write(`${agent.label}\n${lines.join("\n")}\n`);
      }

      return 0;
    }

    default: {
      const _exhaustive: never = parsed;

      return _exhaustive;
    }
  }
}

function findAgents(env: Env): readonly Agent[] {
  const home = env["HOME"] ?? homedir();
  const claude = env["CLAUDE_CONFIG_DIR"] ?? join(home, ".claude");
  const codex = env["CODEX_HOME"] ?? join(home, ".codex");

  return [
    {
      name: "claude",
      label: "Claude Code",
      home: claude,
      skill: join(claude, "skills", "nyte", "SKILL.md"),
      hooks: join(claude, "settings.json"),
    },
    {
      name: "codex",
      label: "Codex",
      home: codex,
      skill: join(codex, "skills", "nyte", "SKILL.md"),
      hooks: join(codex, "hooks.json"),
    },
  ];
}

function skillText(): string {
  return `---
name: nyte
description: Drive Nyte, the durable agent chat host, from the shell with the nyte CLI. Use when the user mentions Nyte or its chats, or asks to run a prompt through Nyte or look up its API.
metadata:
  ${STAMP} "${VERSION}+${SKILL_REVISION}"
---

# Nyte

\`nyte\` runs agent chats that outlive the process. Commands that need a host start their own on \`~/.nyte/nyte.db\`; \`--host-url <url>\` with \`NYTE_HOST_TOKEN\` attaches to a running \`nyte host\` instead, whose URL and token are in \`~/.nyte/host.json\`.

## Discover operations

- \`nyte api list --json\` prints a JSON array, one object per operation: \`name\`, \`summary\`, \`kind\` (\`query\`, \`command\`, \`receipt\`, \`stream\` or \`watch\`), \`authority\`, \`scope\`, and the \`input\` and \`output\` JSON Schemas.
- \`nyte api describe <operation> --json\` prints one of them, for example \`nyte api describe head.send --json\`.

Both read this build's table and start no host.

## Call operations and watch events

These reach the host \`nyte host\` runs, over its local socket \`~/.nyte/host.sock\` when there is one; \`--host-url <url>\` with \`NYTE_HOST_TOKEN\` reaches another. Without a running host they fail; start one with \`nyte host\` in another terminal.

- \`nyte api call <operation> [json-input]\` calls one query, command or receipt and prints its output as JSON, for example \`nyte api call sessions.list '{}'\`. Pass the input as the argument; without one it reads stdin to its end, and an empty stdin means \`{}\`. On failure it prints the wire error, \`{"code":...,"message":...}\`, and exits 1.
- \`nyte events [--scope <scope>]... --json\` subscribes and prints one JSON event per line, \`{"scope":...,"seq":...,"kind":...}\`, until interrupted. A scope is \`host\` (the default: connected clients and what they performed) or \`session/<id>\` (a chat's row changes and its activation). Run it in the background and read its output; stop it when done.

## Run a prompt

- \`nyte -p --json "<prompt>"\` starts a chat in the current folder and prints JSON lines: \`{"type":"text","text":...}\` as the answer streams, \`{"type":"tool","name":...}\` for each tool call, then one \`{"type":"result","kind":...,"code":...,"session":...,"message":...,"next":...}\`.
- Read the last line. \`kind\` is \`completed\`, \`failed\` (\`message\` says why), \`input-required\`, \`aborted\` or \`cancelled\`. Exit codes: 0 completed, 1 failed, 2 the chat waits on an answer, 130 stopped.
- \`nyte -p --json --session <session-id> "<prompt>"\` continues that chat; \`nyte -p --json --resume "<prompt>"\` continues the latest.
- \`next.command\` (\`nyte --session=<id>\`) opens the chat in the TUI; give it to the user instead of running it.

## Check the install

- \`nyte status --json\` lists stored provider credentials; \`nyte doctor --json\` checks the install and names the fix for each problem.
- When a run fails asking for a sign-in, the user runs \`nyte login\` in their own terminal.
`;
}

async function setupAgent(agent: Agent): Promise<readonly string[]> {
  const skill = await skillState(agent.skill);

  if (skill !== "current") {
    await mkdir(dirname(agent.skill), { recursive: true });
    await writeFile(agent.skill, skillText());
  }

  const settings = await readSettings(agent.hooks);
  const hooked = hasHook(settings);

  if (!hooked) await writeSettings(agent.hooks, withHook(settings));

  return [
    row(
      "skill",
      skill === "missing" ? "created" : skill === "outdated" ? "updated" : "unchanged",
      agent.skill,
    ),
    row("hook", hooked ? "unchanged" : "added", agent.hooks),
  ];
}

async function removeAgent(agent: Agent): Promise<readonly string[]> {
  const skill = await readFile(agent.skill, "utf8").catch(() => null);
  const ours = skill !== null && skill.includes(STAMP);

  if (ours) {
    await rm(agent.skill);
    await removeEmpty(dirname(agent.skill));
    await removeEmpty(dirname(dirname(agent.skill)));
  }

  const settings = await readSettings(agent.hooks);
  const hooked = hasHook(settings);

  if (hooked) await writeSettings(agent.hooks, withoutHook(settings));

  return [
    row("skill", ours ? "removed" : "absent", agent.skill),
    row("hook", hooked ? "removed" : "absent", agent.hooks),
  ];
}

async function removeEmpty(directory: string): Promise<void> {
  if ((await readdir(directory)).length === 0) await rmdir(directory);
}

async function statusReport(agent: Agent) {
  const settings = await readSettings(agent.hooks).catch(() => null);

  const hook: HookState =
    settings === null ? "unreadable" : hasHook(settings) ? "present" : "missing";

  return {
    agent: agent.name,
    status: {
      installed: existsSync(agent.home),
      skill: await skillState(agent.skill),
      hook,
      skillPath: agent.skill,
      hooksPath: agent.hooks,
    },
  } as const;
}

function statusLines(
  agents: readonly Agent[],
  report: readonly Awaited<ReturnType<typeof statusReport>>[],
): string {
  return `${report
    .map((entry, index) =>
      [
        `${agents[index].label} (${entry.status.installed ? "installed" : "not installed"})`,
        row("skill", entry.status.skill, entry.status.skillPath),
        row("hook", entry.status.hook, entry.status.hooksPath),
      ].join("\n"),
    )
    .join("\n\n")}\n`;
}

async function skillState(path: string): Promise<SkillState> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null) return "missing";

  return text === skillText() ? "current" : "outdated";
}

async function readSettings(path: string): Promise<JsonObject> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null) return {};
  const value = toJson(JSON.parse(text));

  if (!isJsonObject(value))
    throw new Error(`${path} isn't a JSON object. Fix it, then run the command again.`);

  return value;
}

async function writeSettings(path: string, value: JsonObject): Promise<void> {
  if (Object.keys(value).length === 0) {
    await rm(path, { force: true });

    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hasHook(settings: JsonObject): boolean {
  return sessionStart(settings).some(
    (group) => isJsonObject(group) && handlers(group).some(ourHandler),
  );
}

function withHook(settings: JsonObject): JsonObject {
  const hooks = isJsonObject(settings["hooks"]) ? settings["hooks"] : {};
  const group = { hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 5 }] };

  return { ...settings, hooks: { ...hooks, SessionStart: [...sessionStart(settings), group] } };
}

function withoutHook(settings: JsonObject): JsonObject {
  const hooks = isJsonObject(settings["hooks"]) ? settings["hooks"] : {};

  const groups = sessionStart(settings).flatMap((group): Json[] => {
    if (!isJsonObject(group) || !handlers(group).some(ourHandler)) return [group];
    const kept = handlers(group).filter((handler) => !ourHandler(handler));

    return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
  });

  const nextHooks = replaceKey(hooks, "SessionStart", groups.length === 0 ? undefined : groups);

  return replaceKey(settings, "hooks", Object.keys(nextHooks).length === 0 ? undefined : nextHooks);
}

function replaceKey(object: JsonObject, key: string, value: Json | undefined): JsonObject {
  return Object.fromEntries(
    Object.entries(object).flatMap((entry): [string, Json][] => {
      if (entry[0] !== key) return [entry];

      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function sessionStart(settings: JsonObject): readonly Json[] {
  const hooks = settings["hooks"];
  const groups = isJsonObject(hooks) ? hooks["SessionStart"] : undefined;

  return Array.isArray(groups) ? groups : [];
}

function handlers(group: JsonObject): readonly Json[] {
  const list = group["hooks"];

  return Array.isArray(list) ? list : [];
}

function ourHandler(handler: Json): boolean {
  return isJsonObject(handler) && handler["command"] === HOOK_COMMAND;
}

function row(item: string, state: string, path: string): string {
  return `  ${item.padEnd(6)}${state.padEnd(11)}${path}`;
}

async function hookContext(env: Env): Promise<string> {
  const host = await Promise.race([
    describeHost(env).catch(() => "unknown" as const),
    sleep(HOOK_BUDGET_MS, "unknown" as const, { ref: false }),
  ]);

  const state =
    host === "unknown"
      ? "couldn't tell whether a Nyte host is serving."
      : host === null
        ? "no `nyte host` is serving; each nyte command starts its own host."
        : `a Nyte host ${host.version} is serving at ${host.url}.`;

  return [
    "Nyte",
    `- Host: ${state}`,
    `- CLI: nyte ${VERSION}.`,
    "- To work with Nyte chats or its API from the shell, use the nyte skill.",
    "",
  ].join("\n");
}

async function describeHost(env: Env) {
  const running = await findRunningHost(hostFilePath(env));

  if (running === null) return null;

  const response = await fetch(new URL("/.nyte/describe", running.url), {
    signal: AbortSignal.timeout(HOOK_BUDGET_MS / 2),
  });

  const body: unknown = await response.json();

  return {
    url: running.url,
    version: descriptions.Check(body) ? body.version : "of unknown version",
  };
}

function parseSkillArgs(args: readonly string[]) {
  const command = args[0];
  const rest = args.slice(1);

  if (command === "hook" && rest.length === 0) return { command } as const;

  if (command === "status" && rest.every((arg) => arg === "--json") && rest.length <= 1)
    return { command, json: rest.length === 1 } as const;

  if (command === "setup" || command === "remove") {
    if (rest.length === 0) return { command, agent: "all" } as const;
    const value = rest[0] === "--agent" && rest.length === 2 ? rest[1] : undefined;

    if (value === "claude" || value === "codex" || value === "all")
      return { command, agent: value } as const;
  }

  throw new Error(USAGE);
}
