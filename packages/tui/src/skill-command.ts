import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { HostDescriptionType, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Compile } from "typebox/compile";
import { findRunningHost, hostFilePath } from "@nyte-ai/service/host-endpoint";
import { CliError } from "./cli/errors.ts";
import { parseCommandArgs, readAction } from "./cli/options.ts";
import { formatCommand, formatTable } from "./cli/format.ts";
import type { Output } from "./cli/output.ts";
import { toJson } from "./json.ts";
import type { JsonObject } from "./json.ts";
import { VERSION } from "./version.ts";

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

/** One file setup or remove touches, decided before anything is written. `prune` lists folders to delete once they are empty. */
type Step =
  | { readonly label: "Unchanged"; readonly path: string }
  | {
      readonly label: "Created" | "Updated" | "Changed";
      readonly path: string;
      readonly text: string;
    }
  | { readonly label: "Deleted"; readonly path: string; readonly prune: readonly string[] };

const AGENTS = ["claude", "codex", "all"] as const;

const STAMP = "nyte-skill-version:";

const SKILL_REVISION = 4;

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
  const output = input.output;
  const rerun = ["nyte", "skill", ...input.args];

  switch (parsed.action) {
    case "hook":
      output.result(await hookContext(input.env));

      return 0;
    case "status": {
      const report = await Promise.all(agents.map(statusReport));

      if (parsed.json) {
        output.json(Object.fromEntries(report.map((entry) => [entry.name, entry.status])));

        return 0;
      }

      const rows = report.flatMap((entry) => [
        [entry.label, "config", entry.status.config, entry.status.configPath],
        [entry.label, "skill", entry.status.skill, entry.status.skillPath],
        [entry.label, "hook", entry.status.hook, entry.status.hooksPath],
      ]);

      output.result(
        `${formatTable(["Agent", "Item", "State", "Path"], rows, output.mode.stdout).join("\n")}\n`,
      );

      return 0;
    }

    case "setup": {
      const chosen = agents.filter((agent) =>
        parsed.agent === "all" ? existsSync(agent.home) : agent.name === parsed.agent,
      );

      if (chosen.length === 0)
        throw new CliError("missing_input", "Can't find a Claude Code or Codex config to set up.", {
          details: agents.map((agent) => ({ label: agent.label, value: agent.home })),
          next: [
            {
              label: "Name the agent to set up, claude or codex",
              argv: ["nyte", "skill", "setup", "--agent", "claude"],
            },
          ],
        });

      const steps = (await Promise.all(chosen.map((agent) => planSetup(agent, rerun)))).flat();

      for (const step of steps) await applyStep(step);
      const names = chosen.map((agent) => agent.label).join(" and ");

      output.status(
        "done",
        steps.every((step) => step.label === "Unchanged")
          ? `${names} already ${chosen.length === 1 ? "has" : "have"} the nyte skill and hook`
          : `Set up the nyte skill for ${names}`,
      );
      receipt(output, steps);

      const codexHooked = chosen.some(
        (agent) =>
          agent.name === "codex" &&
          steps.some((step) => step.path === agent.hooks && step.label !== "Unchanged"),
      );

      if (codexHooked)
        output.status("warn", "Codex runs the new hook only after you approve it with /hooks.");

      return 0;
    }

    case "remove": {
      const chosen = agents.filter(
        (agent) => parsed.agent === "all" || agent.name === parsed.agent,
      );

      const plans = await Promise.all(chosen.map((agent) => planRemove(agent, rerun)));
      const steps = plans.flat();

      if (steps.length === 0) {
        output.say("No nyte skill or hook to remove.");
        output.say("");
        output.say("  See each agent's skill and hook:");
        output.say(formatCommand(["nyte", "skill", "status"], output.mode.stderr));

        return 0;
      }

      for (const step of steps) await applyStep(step);

      output.status(
        "done",
        `Removed the nyte skill from ${chosen
          .filter((_, index) => (plans[index]?.length ?? 0) > 0)
          .map((agent) => agent.label)
          .join(" and ")}`,
      );
      receipt(output, steps);

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

const PRINT_SECTION = `## Run a prompt

- \`nyte -p --json "<prompt>"\` starts a chat in the current folder and prints JSON lines on stdout: \`{"type":"text","text":...}\` as the answer streams and \`{"type":"tool","name":...}\` for each tool call. A completed run ends with one \`{"type":"result","outcome":"completed","session":...,"next":[...]}\` and exits 0.
- A run that doesn't complete writes no result line. It prints the error document on stderr, with the chat's id in \`data.session\`. The reasons are \`run_failed\` (exit 1; \`data.remoteMessage\` is the provider's text), \`run_stopped\` (exit 1, another client stopped it), \`unknown_outcome\` (exit 1, it may still be running), \`input_required\` (exit 2, status \`action_required\`; \`data.questions\` holds the agent's questions and choices) and \`canceled\` (130 or 128 + n; \`data.remote\` says what happened to the run).
- To answer a question, or to follow up, run the \`next\` command with the placeholder filled in: \`nyte -p --json --session=<id> "<answer>"\`. \`nyte -p --json --resume "<prompt>"\` continues the latest chat in any folder. Pass the prompt as an argument or on stdin, not both.
- \`nyte --session=<id>\` opens the chat in the full-screen app. Give it to the user instead of running it.
`;

function skillText(): string {
  return `---
name: nyte
description: Drive Nyte, the durable agent chat host, from the shell with the nyte CLI. Use when the user mentions Nyte or its chats, or asks to run a prompt through Nyte or look up its API.
metadata:
  ${STAMP} "${VERSION}+${SKILL_REVISION}"
---

# Nyte

\`nyte\` runs agent chats that outlive the process. One host per machine serves \`~/.nyte\`, and every command is a client of it. \`nyte -p\` starts that host in the background when none serves. Commands that only read never start one; \`nyte api call\` and \`nyte events\` fail with reason \`host_not_running\` and exit 2 when none serves. \`--host-url <url>\` with \`NYTE_HOST_TOKEN\` attaches to another running \`nyte host\`; its URL and token are in \`~/.nyte/host.json\`.

## How commands answer

- stdout holds only the answer. Receipts, progress, warnings and errors go to stderr.
- Exit codes: 0 success, 1 failure, 2 a usage error or missing input (an unknown command or option, a bad value, no running host, a missing sign-in), 130 or 128 + n when a signal stopped it.
- With \`--json\`, a failure prints one JSON document on stderr and nothing on stdout: \`{"status":...,"reason":...,"message":...,"next":[{"command":...,"argv":[...],"when":...}]}\`. \`status\` is \`action_required\` when an input or a step from the user lets the command run, \`error\` otherwise. \`next\` lists the commands that recover, when there are any, and \`data\` holds context such as a file path or the host's error. Branch on \`reason\`, not on \`message\`.
- \`nyte <word>\` is never a prompt: a word that names no command fails as an unknown command with exit 2. A prompt needs \`-p\`.
- \`nyte help <command>\` (or \`nyte <command> --help\`) prints a command's usage, options and notes. It needs no host.

## Discover operations

- \`nyte api list --json\` prints a JSON array, one object per operation: \`name\`, \`summary\`, \`kind\` (\`query\`, \`command\`, \`receipt\`, \`stream\` or \`watch\`), \`authority\`, \`scope\`, and the \`input\` and \`output\` JSON Schemas.
- \`nyte api describe <operation> --json\` prints one of them, for example \`nyte api describe head.send --json\`.

Both read this build's table and start no host.

## Call operations and watch events

These reach the running host over its local socket \`~/.nyte/host.sock\` when there is one; \`--host-url <url>\` with \`NYTE_HOST_TOKEN\` reaches another. Without a running host they fail with \`host_not_running\`. Ask the user to start one with \`nyte host\` in another terminal, or run \`nyte host\` in the background yourself; it serves until stopped.

- \`nyte api call <operation> [json-input]\` calls one query, command or receipt and prints its output as JSON on stdout, for example \`nyte api call sessions.list '{}'\`. Pass the input as the argument; without one it reads stdin to its end, and an empty stdin means \`{}\`. A failed call exits non-zero with the error on stderr, 2 when the host rejects the input; with \`--json\`, the error document's \`data\` holds the host's \`{"code":...,"message":...}\`.
- \`nyte events [--scope <scope>]... --json\` subscribes and prints one JSON event per line, \`{"scope":...,"seq":...,"kind":...}\`, until interrupted. A scope is \`host\` (the default: connected clients and what they performed) or \`session/<id>\` (a chat's row changes and its activation). Run it in the background and read its output; stop it when done.

${PRINT_SECTION}
## Check the install

- \`nyte status --json\` lists stored provider credentials; \`nyte doctor --json\` checks the install and names the fix for each problem.
- When a run fails asking for a sign-in, the user runs \`nyte login\` in their own terminal.
`;
}

async function planSetup(agent: Agent, rerun: readonly string[]): Promise<readonly Step[]> {
  const skill = await skillState(agent.skill);
  const settings = await readSettings(agent.hooks, rerun);
  const hooked = settings !== undefined && hasHook(settings);
  const text = skillText();

  return [
    skill === "current"
      ? { label: "Unchanged", path: agent.skill }
      : { label: skill === "missing" ? "Created" : "Updated", path: agent.skill, text },
    hooked
      ? { label: "Unchanged", path: agent.hooks }
      : {
          label: settings === undefined ? "Created" : "Changed",
          path: agent.hooks,
          text: settingsText(withHook(settings ?? {})),
        },
  ];
}

async function planRemove(agent: Agent, rerun: readonly string[]): Promise<readonly Step[]> {
  const skill = await readFile(agent.skill, "utf8").catch(() => null);
  const settings = await readSettings(agent.hooks, rerun);
  const kept = settings !== undefined && hasHook(settings) ? withoutHook(settings) : undefined;

  const skillSteps: readonly Step[] =
    skill !== null && skill.includes(STAMP)
      ? [
          {
            label: "Deleted",
            path: agent.skill,
            prune: [dirname(agent.skill), dirname(dirname(agent.skill))],
          },
        ]
      : [];

  if (kept === undefined) return skillSteps;

  return [
    ...skillSteps,
    Object.keys(kept).length === 0
      ? { label: "Deleted", path: agent.hooks, prune: [] }
      : { label: "Changed", path: agent.hooks, text: settingsText(kept) },
  ];
}

async function applyStep(step: Step): Promise<void> {
  if (step.label === "Unchanged") return;

  if (step.label === "Deleted") {
    await rm(step.path, { force: true });

    for (const directory of step.prune)
      if ((await readdir(directory)).length === 0) await rmdir(directory);

    return;
  }

  await mkdir(dirname(step.path), { recursive: true });
  await writeFile(step.path, step.text);
}

/** Every path on stderr; the paths that changed alone on stdout when a script reads it. */
function receipt(output: Output, steps: readonly Step[]): void {
  output.rows(steps.map((step) => ({ label: step.label, value: step.path })));

  if (output.mode.tty.stdout && output.mode.interactive) return;

  for (const step of steps) if (step.label !== "Unchanged") output.result(`${step.path}\n`);
}

async function statusReport(agent: Agent) {
  const settings = await readSettings(agent.hooks, []).then(
    (value) => value ?? {},
    () => null,
  );

  const hook: HookState =
    settings === null ? "unreadable" : hasHook(settings) ? "present" : "missing";

  return {
    name: agent.name,
    label: agent.label,
    status: {
      config: existsSync(agent.home) ? "found" : "missing",
      skill: await skillState(agent.skill),
      hook,
      configPath: agent.home,
      skillPath: agent.skill,
      hooksPath: agent.hooks,
    },
  } as const;
}

async function skillState(path: string): Promise<SkillState> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null) return "missing";

  return text === skillText() ? "current" : "outdated";
}

/** `undefined` when the file doesn't exist. */
async function readSettings(
  path: string,
  rerun: readonly string[],
): Promise<JsonObject | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);

  if (text === undefined) return undefined;
  const value = parseSettings(path, text, rerun);

  if (!isJsonObject(value))
    throw new CliError("failed", `Can't change ${basename(path)}: it isn't a JSON object.`, {
      details: [{ label: "File", value: path }],
      next: [{ label: "Fix the file, then run", argv: rerun }],
    });

  return value;
}

/** Bun's JSON parser reports no line or column, so the error names the file and the parser's message. */
function parseSettings(path: string, text: string, rerun: readonly string[]): Json {
  try {
    return toJson(JSON.parse(text));
  } catch (cause) {
    throw new CliError("failed", `Can't change ${basename(path)}: it isn't valid JSON.`, {
      details: [
        { label: "File", value: path },
        { label: "Cause", value: cause instanceof Error ? cause.message : "Not JSON" },
      ],
      next: [{ label: "Fix the file, then run", argv: rerun }],
    });
  }
}

function settingsText(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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

async function hookContext(env: Env): Promise<string> {
  const host = await Promise.race([
    describeHost(env).catch(() => "unknown" as const),
    sleep(HOOK_BUDGET_MS, "unknown" as const, { ref: false }),
  ]);

  const state =
    host === "unknown"
      ? "couldn't tell whether a Nyte host is serving."
      : host === null
        ? "none is serving. `nyte -p` starts one in the background; `nyte api call` and `nyte events` fail with host_not_running until one serves."
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
  const found = readAction("skill", args);
  const action = found.action;

  if (action === "status")
    return { action, json: parseCommandArgs("skill", found.args, 0, action).has("json") } as const;

  if (action === "hook") {
    parseCommandArgs("skill", found.args, 0, action);

    return { action } as const;
  }

  const named = parseCommandArgs("skill", found.args, 0, action).value("agent") ?? "all";
  const agent = AGENTS.find((name) => name === named);

  if (agent === undefined)
    throw new CliError("invalid_arguments", "--agent takes claude, codex or all.", {
      next: [{ label: "See the options", argv: ["nyte", "skill", action, "--help"] }],
    });

  return { action, agent } as const;
}
