import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import process from "node:process";
import type { Json } from "@nyte-ai/sdk";
import { hostFaultsPath } from "@nyte-ai/service/host-endpoint";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { CliError } from "./cli/errors.ts";
import { printable } from "./cli/format.ts";
import type { Invocation } from "./cli/invocation.ts";
import type { Output } from "./cli/output.ts";
import { confirm } from "./cli/prompt.ts";
import { compiled, selfCommand } from "./compiled.ts";
import { nyteHome, runDoctor } from "./doctor-command.ts";
import type { DoctorReport } from "./doctor-command.ts";
import { toJson } from "./json.ts";
import { exitStatus } from "./lifecycle.ts";
import { redact } from "./redact.ts";
import { NEVER_READ, readShareable } from "./secrets.ts";
import { TRIAGE_PLAYBOOK } from "./triage-playbook.ts";
import { VERSION } from "./version.ts";

const REPOSITORY = "interfaces-lab/nyte";

const NEW_ISSUE_URL = `https://github.com/${REPOSITORY}/issues/new?template=bug_report.yml`;

const LOG_LINES = 400;

/** Declining the confirmation the run needs, or Ctrl+C at a prompt, exits as Ctrl+C would. */
const CANCELED_EXIT = exitStatus("SIGINT");

export type TriageAgent = "nyte" | "claude" | "codex";

const AGENTS: readonly TriageAgent[] = ["nyte", "claude", "codex"];

/** The last line `nyte -p --json` prints on stdout when the run completed. */
const resultLines = Compile(Type.Object({ type: Type.Literal("result"), session: Type.String() }));

/** The line `nyte -p --json` prints on stdout when the agent starts a tool. */
const toolLines = Compile(Type.Object({ type: Type.Literal("tool"), name: Type.String() }));

const ErrorDocumentType = Type.Object({
  message: Type.String(),
  data: Type.Optional(Type.Object({ session: Type.Optional(Type.String()) })),
  next: Type.Optional(
    Type.Array(Type.Object({ when: Type.String(), argv: Type.Array(Type.String()) })),
  ),
});

/** The one document `nyte -p --json` prints on stderr when it fails; `data.session` once a session exists. */
type ErrorDocument = Static<typeof ErrorDocumentType>;

const errorDocuments = Compile(ErrorDocumentType);

/** One file of the bundle: shown in the preview, written only after the person agrees. */
interface BundleFile {
  readonly name: string;
  readonly detail: string;
  readonly text: () => Promise<string>;
}

/**
 * Previews the bundle and the agent, asks once, then writes the bundle and starts the agent in it.
 * Nothing is written before the person answers y. Returns the agent's exit code, gh's when the
 * person posts the issue, or 130 when they decline or press Ctrl+C at a prompt.
 */
export async function triageCommand(
  args: readonly string[],
  context: { readonly output: Output; readonly invocation: Invocation },
): Promise<number> {
  const options = parseTriageArgs(args);
  const output = context.output;

  if (!output.mode.interactive || !output.mode.tty.stdout)
    throw new CliError("missing_input", "Can't run triage without an interactive terminal.", {
      next: [{ label: "Print the doctor report for a script", argv: ["nyte", "doctor", "--json"] }],
    });

  const report = await runDoctor(output.mode);
  const agent = pickAgent(report, options.agent);

  if (agent === undefined)
    throw new CliError(
      "missing_input",
      "Can't start triage. No provider has a credential, and neither claude nor codex is on PATH.",
      { next: [{ label: "Sign in so nyte can run it", argv: ["nyte", "login"] }] },
    );

  const folder = join(nyteHome(), "triage", stamp());
  const bundle = await planBundle(report, options.problem);

  output.rows([
    { label: "Agent", value: agentLabel(agent, report) },
    { label: "Folder", value: tilde(folder) },
    ...bundle.map((file) => ({ label: file.name, value: file.detail })),
    { label: "Never read", value: NEVER_READ.join(", ") },
  ]);

  if (options.agent === undefined)
    output.say("  Choose another agent with --agent nyte, --agent claude or --agent codex.");
  output.say("");

  const consented = await confirm(
    output,
    `Write these files and start ${agent} in that folder?`,
    context.invocation.signal,
  );

  if (!consented) {
    output.say("Canceled. Nothing was written.");

    return CANCELED_EXIT;
  }

  await writeBundle(folder, bundle);
  context.invocation.handoff();
  const code = await ownInterrupts(() => startAgent(agent, folder, options.problem, output));

  return ownInterrupts((interrupted) => offerIssue(folder, code, output, interrupted));
}

export function parseTriageArgs(args: readonly string[]) {
  let agent: TriageAgent | undefined;
  const words: string[] = [];
  const help = { next: [{ label: "See the options", argv: ["nyte", "triage", "--help"] }] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    const value =
      arg === "--agent" ? args[++index] : arg.startsWith("--agent=") ? arg.slice(8) : undefined;

    if (arg === "--agent" || arg.startsWith("--agent=")) {
      const known = AGENTS.find((name) => name === value);

      if (known === undefined)
        throw new CliError("invalid_arguments", "--agent takes nyte, claude or codex.", help);
      agent = known;
    } else if (arg.startsWith("-")) {
      throw new CliError("unknown_option", `Unknown option ${arg} for nyte triage.`, help);
    } else {
      words.push(arg);
    }
  }

  return { agent, problem: words.join(" ").trim() };
}

/** The issue draft: the first non-empty line is the title, the rest is the body. */
export function parseIssue(markdown: string): { readonly title: string; readonly body: string } {
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const raw = (lines[first] ?? "").replace(/^#+\s*/u, "").trim();
  const title = raw.startsWith("[Bug]:") ? raw : `[Bug]: ${raw}`;

  return {
    title,
    body: lines
      .slice(first + 1)
      .join("\n")
      .trim(),
  };
}

/** Claude Code settings that deny reading secret files and posting issues. */
export function claudeSettings(home: string = homedir()): string {
  const nyte = nyteHome().replace(home, "~");

  const reads = [
    "auth.json",
    "mcp-auth.json",
    "identity.key",
    "connect.json",
    "host.json",
    "*.key",
    "*.sealed",
  ].map((name) => `Read(${nyte}/${name})`);

  return JSON.stringify({
    permissions: { deny: [...reads, "Read(**/*.key)", "Bash(gh issue:*)", "Bash(gh api:*)"] },
  });
}

function tail(text: string, count: number): string {
  return text.split("\n").slice(-count).join("\n");
}

function tilde(path: string): string {
  return path.replace(homedir(), "~");
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "");
}

function onPath(name: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }).status === 0;
}

function firstLine(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5_000 });

  return result.status === 0 ? (result.stdout.split("\n")[0] ?? "").trim() : "";
}

function systemText(): string {
  const os =
    process.platform === "darwin"
      ? `macOS ${firstLine("sw_vers", ["-productVersion"])}`
      : firstLine("sh", ["-c", '. /etc/os-release && echo "$PRETTY_NAME"']) || process.platform;

  return [
    `os: ${os}`,
    `arch: ${process.arch}`,
    `nyte: ${VERSION}${compiled ? "" : " (from source)"}`,
    `bun: ${process.versions["bun"] ?? "none"}`,
    `shell: ${basename(process.env["SHELL"] ?? "unknown")}`,
    `TERM: ${process.env["TERM"] ?? "unset"}`,
    `TERM_PROGRAM: ${process.env["TERM_PROGRAM"] ?? "unset"}`,
    `COLORTERM: ${process.env["COLORTERM"] ?? "unset"}`,
    `terminal size: ${process.stdout.columns ?? "?"}×${process.stdout.rows ?? "?"}`,
  ].join("\n");
}

/** What the bundle will hold. Reads only the allowlisted logs, each through readShareable, and only when written. */
async function planBundle(report: DoctorReport, problem: string): Promise<readonly BundleFile[]> {
  const logs = join(nyteHome(), "logs");
  const tuiLog = join(logs, "tui.log");
  const faultLog = hostFaultsPath();
  const problems = report.summary.fail;

  const initLogs = existsSync(logs)
    ? (await readdir(logs)).filter((name) => /^init-.*\.log$/u.test(name)).toSorted()
    : [];

  const latestInit = initLogs.at(-1);

  return [
    {
      name: "doctor.json",
      detail: `${report.checks.length} checks, ${problems === 0 ? "no" : String(problems)} problem${problems === 1 ? "" : "s"}`,
      text: async () => `${JSON.stringify(report, null, 2)}\n`,
    },
    ...(existsSync(tuiLog)
      ? [
          {
            name: "tui.log",
            detail: `last ${LOG_LINES} lines, redacted`,
            text: async () => tail(await readShareable(tuiLog), LOG_LINES),
          },
        ]
      : []),
    ...(existsSync(faultLog)
      ? [
          {
            name: "host-faults.log",
            detail: `last ${LOG_LINES} lines, redacted`,
            text: async () => tail(await readShareable(faultLog), LOG_LINES),
          },
        ]
      : []),
    ...(latestInit === undefined
      ? []
      : [
          {
            name: "init.log",
            detail: `the last npx nyte-ai init run, ${latestInit.slice(5, 13)}, redacted`,
            text: async () => tail(await readShareable(join(logs, latestInit)), LOG_LINES),
          },
        ]),
    {
      name: "system.txt",
      detail: "OS, arch, terminal, shell and versions",
      text: async () => `${systemText()}\n`,
    },
    ...(problem === ""
      ? []
      : [{ name: "problem.txt", detail: "your description", text: async () => `${problem}\n` }]),
  ];
}

async function writeBundle(folder: string, bundle: readonly BundleFile[]): Promise<void> {
  await mkdir(folder, { recursive: true, mode: 0o700 });

  for (const file of bundle)
    await writeFile(join(folder, file.name), redact(await file.text()), { mode: 0o600 });
}

/** Nyte when a provider has a credential, else Claude Code, else Codex. With no host running the credentials are unknown, so Nyte goes last instead of not at all. */
function pickAgent(
  report: DoctorReport,
  requested: TriageAgent | undefined,
): TriageAgent | undefined {
  if (requested !== undefined) return requested;
  const providers = report.checks.find((check) => check.id === "providers")?.status;

  if (providers === "ok") return "nyte";

  if (onPath("claude")) return "claude";

  if (onPath("codex")) return "codex";

  return providers === "skip" ? "nyte" : undefined;
}

function agentLabel(agent: TriageAgent, report: DoctorReport): string {
  switch (agent) {
    case "nyte": {
      const providers = report.checks.find((check) => check.id === "providers");

      return providers?.status === "ok" ? `nyte with ${providers.detail}` : "nyte";
    }

    case "claude":
      return `claude (${printable(firstLine("claude", ["--version"])) || "Claude Code"})`;
    case "codex":
      return `codex (${printable(firstLine("codex", ["--version"])) || "Codex"})`;
    default: {
      const _exhaustive: never = agent;

      return _exhaustive;
    }
  }
}

/**
 * After the handoff, Ctrl+C is triage's to handle. The agent gets its own from the terminal, so
 * triage ignores it and stays alive to offer the issue; at the issue question it cancels. Each
 * call listens afresh, so a Ctrl+C meant for the agent doesn't answer the question.
 */
async function ownInterrupts<T>(work: (interrupted: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.on("SIGINT", interrupt);

  try {
    return await work(controller.signal);
  } finally {
    process.off("SIGINT", interrupt);
  }
}

function run(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Sends the playbook as the first turn with `nyte -p --json`, naming each tool the agent runs as
 * its line arrives, then opens that session in the TUI. The session comes from the `result` line on
 * stdout, or from the error document's `data.session` on stderr when the run didn't complete; a run
 * that never started a session fails here.
 */
async function runNyte(folder: string, message: string, output: Output): Promise<number> {
  const command = selfCommand();
  output.progress("Sending the playbook to nyte…");

  const first = spawn(
    command[0],
    [...command.slice(1), "-p", "--json", "--no-context-files", message],
    { cwd: folder, stdio: ["ignore", "pipe", "pipe"] },
  );

  const stderr = new Response(first.stderr).text();
  const closed = new Promise((resolve) => first.once("close", resolve));
  let completed: string | undefined;

  for await (const text of createInterface({ input: first.stdout, crlfDelay: Infinity })) {
    const line = jsonLine(text);

    if (toolLines.Check(line)) output.progress(`Running ${printable(line.name)}…`);

    if (resultLines.Check(line)) completed = line.session;
  }

  const failure = (await stderr)
    .split("\n")
    .map(jsonLine)
    .findLast((line) => errorDocuments.Check(line));

  await closed;
  const session = completed ?? failure?.data?.session;

  if (session === undefined) throw childFailure(failure);
  output.status("none", "Opening the triage chat…");

  return run(command[0], [...command.slice(1), "--session", session], folder);
}

/** One line of the child's output as JSON, or `undefined` for a line that isn't. */
function jsonLine(line: string): Json | undefined {
  try {
    return toJson(JSON.parse(line));
  } catch {
    return undefined;
  }
}

/** nyte's own error document, retold as triage's failure with the same recovery commands. */
function childFailure(document: ErrorDocument | undefined): CliError {
  return new CliError("failed", "Couldn't start the triage chat in nyte.", {
    details:
      document === undefined ? [] : [{ label: "Reason", value: printable(document.message) }],
    next: (document?.next ?? []).map((step) => ({ label: step.when, argv: step.argv })),
  });
}

async function startAgent(
  agent: TriageAgent,
  folder: string,
  problem: string,
  output: Output,
): Promise<number> {
  const request = problem === "" ? "Start triage." : `Start triage. The person says: ${problem}`;

  switch (agent) {
    case "nyte":
      return runNyte(folder, `${TRIAGE_PLAYBOOK}\n\n${request}`, output);
    case "claude":
      return run(
        "claude",
        ["--append-system-prompt", TRIAGE_PLAYBOOK, "--settings", claudeSettings(), request],
        folder,
      );
    case "codex":
      return run(
        "codex",
        ["-C", folder, "-s", "workspace-write", `${TRIAGE_PLAYBOOK}\n\n${request}`],
        folder,
      );
    default: {
      const _exhaustive: never = agent;

      return _exhaustive;
    }
  }
}

/** Prints the whole issue, asks, and creates it with gh only after y. Declining keeps the agent's exit code; Ctrl+C (`signal`) exits 130. */
async function offerIssue(
  folder: string,
  agentCode: number,
  output: Output,
  signal: AbortSignal,
): Promise<number> {
  const draft = join(folder, "issue.md");
  output.say("");

  if (!existsSync(draft)) {
    output.say(`The agent didn't write an issue. The files stay in ${tilde(folder)}.`);

    return agentCode;
  }

  const issue = parseIssue(redact(await readShareable(draft)));
  output.say("The agent wrote an issue. This is everything gh would post:");
  output.say("");
  output.rows([
    { label: "Repository", value: REPOSITORY },
    { label: "Label", value: "bug" },
    { label: "Title", value: printable(issue.title) },
  ]);
  output.say("");

  for (const line of issue.body.split("\n")) output.say(`  ${printable(line)}`);
  output.say("");

  const redacted = join(folder, "issue.redacted.md");
  await writeFile(redacted, `${issue.body}\n`, { mode: 0o600 });

  if (!onPath("gh") || spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
    output.say("gh isn't installed or signed in. Open the issue form and paste the draft:");
    output.rows([
      { label: "Form", value: NEW_ISSUE_URL },
      { label: "Draft", value: tilde(redacted) },
    ]);

    return agentCode;
  }

  const login = printable(firstLine("gh", ["api", "user", "--jq", ".login"]));

  const posting = await confirm(
    output,
    `Create this issue on ${REPOSITORY}${login === "" ? "" : ` as ${login}`}?`,
    signal,
  );

  if (!posting) {
    output.say(`Not posted. The draft is at ${tilde(redacted)}.`);

    return signal.aborted ? CANCELED_EXIT : agentCode;
  }

  return run(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      REPOSITORY,
      "--title",
      issue.title,
      "--body-file",
      redacted,
      "--label",
      "bug",
    ],
    folder,
  );
}
