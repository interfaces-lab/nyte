import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { alignedRows, ansiEnabled, bold, dim } from "./cli-style.ts";
import { compiled, selfCommand } from "./compiled.ts";
import { nyteHome, runDoctor, type DoctorReport } from "./doctor-command.ts";
import { redact } from "./redact.ts";
import { NEVER_READ, readShareable } from "./secrets.ts";
import { TRIAGE_PLAYBOOK } from "./triage-playbook.ts";
import { VERSION } from "./version.ts";

const REPOSITORY = "interfaces-lab/nyte";

const NEW_ISSUE_URL = `https://github.com/${REPOSITORY}/issues/new?template=bug_report.yml`;

const LOG_LINES = 400;

export type TriageAgent = "nyte" | "claude" | "codex";

const AGENTS: readonly TriageAgent[] = ["nyte", "claude", "codex"];

export const TRIAGE_USAGE = [
  "Usage: nyte triage [--agent nyte|claude|codex] [<what went wrong>]",
  "Collects nyte doctor's report and redacted logs into ~/.nyte/triage/<time>/, then starts an agent",
  "there with a playbook to find the cause. Nyte is the agent when a provider has a credential;",
  "otherwise Claude Code, then Codex. If the agent writes an issue, triage prints all of it and",
  "creates it with gh only after you answer y. Never reads auth.json, identity.key, connect.json",
  "or other key files. Needs an interactive terminal.",
  'Example: nyte triage "the desktop app shows a blank window after updating"',
].join("\n");

export function parseTriageArgs(args: readonly string[]): {
  readonly agent?: TriageAgent;
  readonly problem: string;
} {
  let agent: TriageAgent | undefined;
  const words: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    const value =
      arg === "--agent" ? args[++index] : arg.startsWith("--agent=") ? arg.slice(8) : undefined;

    if (arg === "--agent" || arg.startsWith("--agent=")) {
      const known = AGENTS.find((name) => name === value);

      if (known === undefined)
        throw new Error(`--agent takes nyte, claude or codex.\n${TRIAGE_USAGE}`);
      agent = known;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}.\n${TRIAGE_USAGE}`);
    } else {
      words.push(arg);
    }
  }

  return { ...(agent === undefined ? {} : { agent }), problem: words.join(" ").trim() };
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

function tail(text: string, count: number): string {
  return text.split("\n").slice(-count).join("\n");
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

interface Collected {
  readonly folder: string;
  readonly rows: readonly { readonly label: string; readonly detail: string }[];
}

/** Writes the bundle. Reads only the allowlisted logs, each through readShareable, and redacts them. */
async function collect(report: DoctorReport, problem: string): Promise<Collected> {
  const home = nyteHome();
  const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "");
  const folder = join(home, "triage", stamp);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const rows: { label: string; detail: string }[] = [];

  const write = (name: string, text: string) =>
    writeFile(join(folder, name), redact(text), { mode: 0o600 });

  const problems = report.summary.fail;

  await write("doctor.json", `${JSON.stringify(report, null, 2)}\n`);
  rows.push({
    label: "doctor.json",
    detail: `${report.checks.length} checks, ${problems} problem${problems === 1 ? "" : "s"}`,
  });

  const logs = join(home, "logs");
  const tuiLog = join(logs, "tui.log");

  if (existsSync(tuiLog)) {
    await write("tui.log", tail(await readShareable(tuiLog), LOG_LINES));
    rows.push({ label: "tui.log", detail: `last ${LOG_LINES} lines` });
  }

  const initLogs = existsSync(logs)
    ? (await readdir(logs)).filter((name) => /^init-.*\.log$/u.test(name)).toSorted()
    : [];

  const latestInit = initLogs.at(-1);

  if (latestInit !== undefined) {
    await write("init.log", tail(await readShareable(join(logs, latestInit)), LOG_LINES));
    rows.push({
      label: "init.log",
      detail: `the last npx nyte-ai init run, ${latestInit.slice(5, 13)}`,
    });
  }

  await write("system.txt", `${systemText()}\n`);
  rows.push({ label: "system.txt", detail: "OS, arch, terminal, shell and versions" });

  if (problem !== "") {
    await write("problem.txt", `${problem}\n`);
    rows.push({ label: "problem.txt", detail: "your description" });
  }

  return { folder, rows };
}

function pickAgent(
  report: DoctorReport,
  requested: TriageAgent | undefined,
): TriageAgent | undefined {
  if (requested !== undefined) return requested;

  if (report.checks.some((check) => check.id === "providers" && check.status === "ok"))
    return "nyte";

  if (onPath("claude")) return "claude";

  if (onPath("codex")) return "codex";

  return undefined;
}

function agentLabel(agent: TriageAgent, report: DoctorReport): string {
  switch (agent) {
    case "nyte":
      return `nyte, ${report.checks.find((check) => check.id === "providers")?.detail ?? ""}`;
    case "claude":
      return `claude (${firstLine("claude", ["--version"]) || "Claude Code"})`;
    case "codex":
      return `codex (${firstLine("codex", ["--version"]) || "Codex"})`;
    default: {
      const _exhaustive: never = agent;

      return _exhaustive;
    }
  }
}

function ignoreSignal(): void {}

/** Ctrl-C belongs to the agent while it runs; triage stays alive to offer the issue after. */
async function whileAgentRuns<T>(work: () => Promise<T>): Promise<T> {
  process.on("SIGINT", ignoreSignal);

  try {
    return await work();
  } finally {
    process.off("SIGINT", ignoreSignal);
  }
}

function run(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

/** Sends the playbook as the first turn in print mode, then opens that session in the TUI. */
async function runNyte(folder: string, message: string): Promise<number> {
  const [command, ...prefix] = selfCommand();

  const first = spawn(command, [...prefix, "-p", "--no-context-files", message], {
    cwd: folder,
    stdio: ["inherit", "inherit", "pipe"],
  });

  let stderr = "";
  first.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });
  await new Promise((resolve) => first.once("exit", resolve));
  const session = stderr.match(/session (\S+) ·/u)?.[1];

  if (session === undefined) return 1;

  return run(command, [...prefix, "--session", session], folder);
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

async function startAgent(agent: TriageAgent, folder: string, problem: string): Promise<number> {
  const request = problem === "" ? "Start triage." : `Start triage. The person says: ${problem}`;

  switch (agent) {
    case "nyte":
      return runNyte(folder, `${TRIAGE_PLAYBOOK}\n\n${request}`);
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

async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return (await prompt.question(question)).trim().toLowerCase();
  } finally {
    prompt.close();
  }
}

/** Prints the whole issue, asks, and creates it with gh only after y. */
async function offerIssue(folder: string, color: boolean): Promise<number> {
  const draft = join(folder, "issue.md");

  if (!existsSync(draft)) {
    console.log(
      `\nThe agent didn't write an issue. The folder stays at ${folder.replace(homedir(), "~")}.`,
    );

    return 0;
  }

  const { title, body } = parseIssue(redact(await readShareable(draft)));
  const rule = dim("─".repeat(Math.min(process.stdout.columns ?? 72, 72) - 2), color);
  console.log(
    [
      "",
      bold("nyte triage", color),
      "",
      "  The agent wrote an issue. This is all of it:",
      "",
      ...alignedRows(
        [
          { label: "repo", detail: REPOSITORY },
          { label: "label", detail: "bug" },
          { label: "title", detail: title },
        ],
        color,
      ),
      `  ${rule}`,
      ...body.split("\n").map((line) => `  ${line}`),
      `  ${rule}`,
      "",
    ].join("\n"),
  );

  const redacted = join(folder, "issue.redacted.md");
  await writeFile(redacted, `${body}\n`, { mode: 0o600 });

  if (!onPath("gh") || spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
    console.log(
      `gh isn't installed or logged in. Open ${NEW_ISSUE_URL}\nand paste ${redacted.replace(homedir(), "~")}.`,
    );

    return 0;
  }

  const login = firstLine("gh", ["api", "user", "--jq", ".login"]);

  const answer = await ask(
    `Create this issue on ${REPOSITORY}${login === "" ? "" : ` as ${login}`}? [y/N] `,
  );

  if (answer !== "y" && answer !== "yes") {
    console.log(`Not posted. The draft is at ${redacted.replace(homedir(), "~")}.`);

    return 0;
  }

  return run(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      REPOSITORY,
      "--title",
      title,
      "--body-file",
      redacted,
      "--label",
      "bug",
    ],
    folder,
  );
}

export async function triageCommand(args: readonly string[]): Promise<number> {
  const { agent: requested, problem } = parseTriageArgs(args);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "nyte triage needs an interactive terminal. For a report to script against, run nyte doctor --json.",
    );
  }

  const color = ansiEnabled();
  const report = await runDoctor();
  const { folder, rows } = await collect(report, problem);
  const agent = pickAgent(report, requested);
  const where = folder.replace(homedir(), "~");

  console.log(
    [
      `${bold("nyte triage", color)}  ${dim(`${VERSION} · ${report.target}`, color)}`,
      "",
      `  collected into ${where}/ (redacted)`,
      ...alignedRows(rows, color, 12),
      "",
      ...alignedRows([{ label: "not read", detail: NEVER_READ.join(", ") }], color, 12),
      "",
      ...alignedRows(
        [
          {
            label: "agent",
            detail:
              agent === undefined
                ? "none: no Nyte provider, no claude, no codex on PATH"
                : agentLabel(agent, report),
          },
        ],
        color,
        12,
      ),
    ].join("\n"),
  );

  if (agent === undefined) {
    console.log(
      `\nNothing to start. Read the folder, then open an issue with it:\n  ${where}/\n  ${NEW_ISSUE_URL}`,
    );

    return 1;
  }

  if (requested === undefined && agent !== "nyte") {
    console.log(
      dim("  Nyte has no provider with a credential. Run nyte login to use Nyte.", color),
    );
  } else if (requested === undefined) {
    console.log(dim("  Pick another with --agent claude or --agent codex.", color));
  }

  const answer = await ask("\nStart the agent in that folder? [Y/n] ");

  if (answer !== "" && answer !== "y" && answer !== "yes") {
    console.log(`Not started. The folder stays at ${where}/.`);

    return 0;
  }

  await whileAgentRuns(() => startAgent(agent, folder, problem));

  return offerIssue(folder, color);
}
