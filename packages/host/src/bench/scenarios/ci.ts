import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { KIT_SPECIFIER } from "@nyte-ai/plugin/canvas/protocol";
import type { Reply } from "../fake-models.ts";
import { afterTool, afterUser, script } from "../script.ts";
import type { Script } from "../script.ts";
import { CI_SERVER, GH_CLI, nodeShim, scenarioHome } from "./home.ts";
import type { ScenarioHome } from "./home.ts";

const run = promisify(execFile);

/** Scenario D's message. */
export const CI_PROMPT = "why did CI fail on my PR, fix it";

/** Where scenario D reads CI from: the GitHub-like MCP server, or the `gh` CLI through `bash`. */
export type CiRoute = "mcp" | "gh";

/** Scenario D's skill, which leaves the route to what the session has: the CI MCP tools when they are listed, else `gh`. */
export const CI_SKILL = `---
name: ci-triage
description: Find why CI failed on the current pull request and fix it.
---
1. Read the checks. If the mcp__ci__ tools are listed, call mcp__ci__list_check_runs with ref "HEAD", then mcp__ci__get_job_logs for the failing job. Otherwise run \`gh pr checks\`, then \`gh run view <job> --log-failed\`, with bash.
2. Show each failure with canvas_render: the test, its file:line as a link, and the log excerpt.
3. Run the failing test with bash, fix the code, rerun it until it passes.
`;

/** The log lines scenario D's canvas quotes. */
const EXCERPT = "not ok 1 - sum adds\\n  Expected values to be strictly equal:\\n\\n  -1 !== 3";

/** Scenario D's canvas: the failing test with file:line links, the suspect source line, the log excerpt and the job's web link. */
export const CI_CANVAS = `import { Badge, Callout, Card, Code, Stack, Table, Text } from "${KIT_SPECIFIER}";

const FAILURES = [
  { test: "sum adds", file: "test/sum.test.js", line: 6, job: "https://ci.fixture.test/run/1/job/2" },
];

export default function CiFailures() {
  return (
    <Card title="CI failures">
      <Stack gap={3}>
        <Table
          columns={[
            { key: "test", label: "Test" },
            { key: "where", label: "Where" },
            { key: "state", label: "" },
          ]}
          rows={FAILURES.map((failure) => ({
            test: failure.test,
            where: <a href={failure.file + ":" + failure.line}>{failure.file + ":" + failure.line}</a>,
            state: <Badge tone="danger">fail</Badge>,
          }))}
        />
        <Callout tone="danger" title="Suspect">
          <Text>
            <a href="src/sum.js:2">src/sum.js:2</a> subtracts instead of adding.
          </Text>
        </Callout>
        <Code block>{"${EXCERPT}"}</Code>
        <a href={FAILURES[0].job}>Open the job log</a>
      </Stack>
    </Card>
  );
}
`;

/** Scenario D's last answer. */
export const CI_ANSWER =
  "Fixed `src/sum.js:2`: `sum` subtracted its arguments. `node --test` passes now; [the failing job](https://ci.fixture.test/run/1/job/2).";

const PACE: Reply["timing"] = { firstMs: 30, deltaMs: 2 };

const TEST_COMMAND = "node --test";

/**
 * Scenario D as the model answers it: read the skill at `skill`, read the
 * check runs and the failing job's log (`route`), render the failures, run the
 * failing test, fix `src/sum.js`, rerun it, then answer.
 */
export function ciScript(input: { readonly skill: string; readonly route: CiRoute }): Script {
  const call = (
    id: string,
    name: string,
    args: Record<string, unknown>,
    deltas?: number,
  ): Reply => ({
    timing: PACE,
    content: [{ type: "toolCall", id, name, arguments: args, deltas }],
  });

  const bash = (id: string, command: string, description: string): Reply =>
    call(id, "bash", { command, description });

  const reading =
    input.route === "mcp"
      ? [
          {
            name: "list check runs",
            when: afterTool("read"),
            reply: call("checks", "mcp__ci__list_check_runs", { ref: "HEAD" }),
          },
          {
            name: "read the job log",
            when: afterTool("mcp__ci__list_check_runs"),
            reply: call("log", "mcp__ci__get_job_logs", { job_id: 2 }),
          },
        ]
      : [
          {
            name: "list check runs",
            when: afterTool("read"),
            reply: bash("checks", "gh pr checks", "List the pull request's checks"),
          },
          {
            name: "read the job log",
            when: afterTool("bash"),
            reply: bash("log", "gh run view 2 --log-failed", "Read the failing job's log"),
          },
        ];

  return script([
    {
      name: "read the skill",
      when: afterUser,
      reply: {
        timing: PACE,
        content: [
          { type: "text", text: "Let me look at the checks." },
          { type: "toolCall", id: "skill", name: "read", arguments: { path: input.skill } },
        ],
      },
    },
    ...reading,
    {
      name: "render the failures",
      when: afterTool(input.route === "mcp" ? "mcp__ci__get_job_logs" : "bash"),
      reply: call("canvas", "canvas_render", { title: "CI failures", source: CI_CANVAS }, 40),
    },
    {
      name: "run the failing test",
      when: afterTool("canvas_render"),
      reply: bash("test", TEST_COMMAND, "Run the failing test"),
    },
    {
      name: "fix the code",
      when: afterTool("bash"),
      reply: call("fix", "edit", {
        path: "src/sum.js",
        edits: [{ oldText: "a - b", newText: "a + b" }],
      }),
    },
    {
      name: "rerun the test",
      when: afterTool("edit"),
      reply: bash("retest", TEST_COMMAND, "Rerun the test"),
    },
    {
      name: "answer",
      when: afterTool("bash"),
      reply: { timing: PACE, tokens: 12, content: [{ type: "text", text: CI_ANSWER }] },
    },
  ]);
}

/** A home for scenario D: the CI server (route `mcp` only, with `env` knobs) and the CI skill. */
export function ciHome(input?: {
  readonly route?: CiRoute;
  readonly env?: Readonly<Record<string, string>>;
  readonly root?: string;
}): Promise<ScenarioHome> {
  return scenarioHome({
    servers: input?.route === "gh" ? {} : { ci: { script: CI_SERVER, env: input?.env ?? {} } },
    skills: { "ci-triage": CI_SKILL },
    root: input?.root,
  });
}

/** A temporary git repo whose one test fails, and the `gh` stand-in beside it. */
export interface CiRepo extends AsyncDisposable {
  readonly root: string;
  /** The folder holding the `gh` stand-in. */
  readonly bin: string;
  /** `PATH` with `bin` first, for a process that should find the `gh` stand-in. */
  readonly path: string;
}

const FILES = {
  "package.json": `${JSON.stringify({ name: "ci-fixture", private: true, type: "module", scripts: { test: TEST_COMMAND } }, null, 2)}\n`,
  "src/sum.js": "export function sum(a, b) {\n  return a - b;\n}\n",
  "test/sum.test.js": `import assert from "node:assert/strict";
import test from "node:test";
import { sum } from "../src/sum.js";

test("sum adds", () => {
  assert.equal(sum(1, 2), 3);
});
`,
} satisfies Readonly<Record<string, string>>;

/**
 * Creates a git repo under `root` (default the system temp folder) on branch
 * `fix-sum` with one commit: `src/sum.js` subtracts, so `node --test` fails
 * at `test/sum.test.js:6`, as the CI fixtures report. Disposing it removes
 * the repo and the `gh` stand-in.
 */
export async function ciRepo(root?: string): Promise<CiRepo> {
  const parent = await realpath(await mkdtemp(join(root ?? tmpdir(), "nyte-ci-")));
  const repo = join(parent, "repo");
  const bin = join(parent, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "test"), { recursive: true });

  for (const [path, contents] of Object.entries(FILES)) await writeFile(join(repo, path), contents);
  const git = (...args: string[]) => run("git", args, { cwd: repo });
  await git("init", "--quiet", "--initial-branch", "fix-sum");
  await git("config", "user.email", "fixture@nyte.test");
  await git("config", "user.name", "Fixture");
  await git("config", "commit.gpgsign", "false");
  await git("add", "-A");
  await git("commit", "--quiet", "-m", "Add sum");
  await nodeShim(bin, "gh", GH_CLI);

  return {
    root: repo,
    bin,
    path: [bin, process.env.PATH ?? ""].join(delimiter),
    [Symbol.asyncDispose]: () => rm(parent, { recursive: true, force: true }),
  };
}
