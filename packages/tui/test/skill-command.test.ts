import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Json } from "@nyte-ai/schema";
import { formatRows, formatStatus } from "../src/cli/format.ts";
import { resolveMode } from "../src/cli/mode.ts";
import type { Output } from "../src/cli/output.ts";
import { skillCommand } from "../src/skill-command.ts";

const OURS = { hooks: [{ type: "command", command: "nyte skill hook", timeout: 5 }] };

const THEIRS = { hooks: [{ type: "command", command: "echo session" }] };

const pretty = (value: Json): string => `${JSON.stringify(value, null, 2)}\n`;

const UNRELATED = pretty({
  model: "opus",
  hooks: { SessionStart: [THEIRS], Stop: [THEIRS] },
  theme: "dark",
});

const MERGED = pretty({
  model: "opus",
  hooks: { SessionStart: [THEIRS, OURS], Stop: [THEIRS] },
  theme: "dark",
});

const ONLY_OURS = pretty({ hooks: { SessionStart: [OURS] } });

const OLD_SKILL = '---\nname: nyte\nmetadata:\n  nyte-skill-version: "0.0.1"\n---\n';

const SET_UP = { config: "found", skill: "current", hook: "present" };

const BARE = { config: "found", skill: "missing", hook: "missing" };

interface Case {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly steps: readonly (readonly string[])[];
  readonly said: readonly string[];
  readonly settings: { readonly claude: string | null; readonly codex: string | null };
  readonly status: { readonly claude: object; readonly codex: object };
}

const CASES: readonly Case[] = [
  {
    name: "setup on empty config adds the skill and the hook to both agents",
    files: { ".claude/.keep": "", ".codex/.keep": "" },
    steps: [["setup"]],
    said: ["Created", "Created", "Created", "Created"],
    settings: { claude: ONLY_OURS, codex: ONLY_OURS },
    status: { claude: SET_UP, codex: SET_UP },
  },
  {
    name: "setup keeps every other key and hook",
    files: { ".claude/settings.json": UNRELATED, ".codex/.keep": "" },
    steps: [["setup", "--agent", "claude"]],
    said: ["Created", "Changed"],
    settings: {
      claude: MERGED,
      codex: null,
    },
    status: { claude: SET_UP, codex: BARE },
  },
  {
    name: "setup twice changes nothing the second time",
    files: { ".claude/settings.json": UNRELATED, ".codex/.keep": "" },
    steps: [["setup"], ["setup"]],
    said: ["Unchanged", "Unchanged", "Unchanged", "Unchanged"],
    settings: {
      claude: MERGED,
      codex: ONLY_OURS,
    },
    status: { claude: SET_UP, codex: SET_UP },
  },
  {
    name: "remove deletes only what setup added",
    files: { ".claude/settings.json": UNRELATED, ".codex/.keep": "" },
    steps: [["setup"], ["remove"]],
    said: ["Deleted", "Changed", "Deleted", "Deleted"],
    settings: { claude: UNRELATED, codex: null },
    status: { claude: BARE, codex: BARE },
  },
  {
    name: "setup without --agent skips an agent that isn't installed",
    files: { ".claude/.keep": "" },
    steps: [["setup"]],
    said: ["Created", "Created"],
    settings: { claude: ONLY_OURS, codex: null },
    status: { claude: SET_UP, codex: { config: "missing", skill: "missing", hook: "missing" } },
  },
  {
    name: "status calls an older skill outdated and a broken settings file unreadable",
    files: { ".claude/skills/nyte/SKILL.md": OLD_SKILL, ".codex/hooks.json": "{ not json" },
    steps: [],
    said: [],
    settings: { claude: null, codex: "{ not json" },
    status: {
      claude: { config: "found", skill: "outdated", hook: "missing" },
      codex: { config: "found", skill: "missing", hook: "unreadable" },
    },
  },
];

test.each(CASES)("$name", async (entry) => {
  const home = await mkdtemp(join(tmpdir(), "nyte-skill-"));

  try {
    for (const file of Object.entries(entry.files)) {
      await mkdir(dirname(join(home, file[0])), { recursive: true });
      await writeFile(join(home, file[0]), file[1]);
    }

    let said = "";

    for (const args of entry.steps) {
      const run = capture();
      const code = await skillCommand({ args, env: { HOME: home }, output: run.output });

      expect(code).toBe(0);
      said = run.streams.stderr;
    }

    expect([...said.matchAll(/^ {2}(\w+) +\/\S+$/gmu)].map((match) => match[1])).toEqual([
      ...entry.said,
    ]);
    expect({
      claude: await textIn(join(home, ".claude", "settings.json")),
      codex: await textIn(join(home, ".codex", "hooks.json")),
    }).toEqual(entry.settings);

    const report = capture();

    await skillCommand({ args: ["status", "--json"], env: { HOME: home }, output: report.output });

    expect(JSON.parse(report.streams.stdout)).toMatchObject(entry.status);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

/** A plain, non-interactive run: both streams are pipes. */
function capture() {
  const streams = { stdout: "", stderr: "" };
  const mode = resolveMode({ env: {}, stdin: {}, stdout: {}, stderr: {} }, false);

  const output: Output = {
    mode,
    closed: new AbortController().signal,
    result: (text) => void (streams.stdout += text),
    json: (value) => void (streams.stdout += `${JSON.stringify(value)}\n`),
    say: (text) => void (streams.stderr += `${text}\n`),
    rows: (rows) => void (streams.stderr += formatRows(rows, mode.stderr).join("\n") + "\n"),
    status: (gutter, text) =>
      void (streams.stderr += `${formatStatus(gutter, text, mode.stderr)}\n`),
    progress: (phase) => void (streams.stderr += `${phase}\n`),
  };

  return { output, streams };
}

function textIn(path: string): Promise<string | null> {
  return existsSync(path) ? readFile(path, "utf8") : Promise.resolve(null);
}
