import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { findRunningHost, hostFilePath } from "@nyte-ai/service/host-endpoint";
import type { RunningHost } from "@nyte-ai/service/host-endpoint";
import { CliError } from "./cli/errors.ts";
import { formatRows } from "./cli/format.ts";
import type { Gutter, Row } from "./cli/format.ts";
import type { Mode, Presentation } from "./cli/mode.ts";
import type { Output } from "./cli/output.ts";
import { compiled } from "./compiled.ts";
import { toJson } from "./json.ts";
import { availableModels } from "./lib/catalog.ts";
import { errorMessage } from "./lib/format.ts";
import { connectHost } from "./local-host.ts";
import { secretFilesIn } from "./secrets.ts";
import { findUpdate } from "./releases.ts";
import { VERSION } from "./version.ts";

/** `skip` is a check that didn't run, on purpose or because another check failed; it is no problem. */
export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** The command or change that fixes a warn or fail. */
  readonly fix?: string;
}

export interface DoctorReport {
  readonly version: string;
  readonly target: string;
  readonly checks: readonly DoctorCheck[];
  readonly summary: Readonly<Record<CheckStatus, number>>;
}

const CRASH_WINDOW_MS = 7 * 24 * 60 * 60_000;

const GUTTERS: Readonly<Record<CheckStatus, Gutter>> = {
  ok: "none",
  skip: "none",
  warn: "warn",
  fail: "fail",
};

export function nyteHome(): string {
  return process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");
}

/** Prints the report, as one JSON document with `--json`. Exits 1 when a check fails. */
export async function doctorCommand(args: readonly string[], output: Output): Promise<number> {
  const help = { next: [{ label: "See the options", argv: ["nyte", "doctor", "--help"] }] };
  const extra = args.find((arg) => arg !== "--json");

  if (extra?.startsWith("-") === true)
    throw new CliError("unknown_option", `Unknown option ${extra} for nyte doctor.`, help);

  if (extra !== undefined)
    throw new CliError("invalid_arguments", "nyte doctor takes no arguments.", help);
  const report = await runDoctor(output.mode);

  if (args.includes("--json")) output.json(toJson(report));
  else output.result(`${renderDoctor(report, output.mode.stdout).join("\n")}\n`);

  if (
    output.mode.interactive &&
    existsSync(join(process.cwd(), "pnpm-workspace.yaml")) &&
    existsSync(join(process.cwd(), "packages", "tui"))
  )
    output.say("Tip: This is a nyte checkout. Check the dev setup with npx nyte-ai init --check");

  return report.summary.fail > 0 ? 1 : 0;
}

/** Runs every check. Changes nothing and starts no host: without one, the host check says so and providers go unchecked. */
export async function runDoctor(mode: Mode): Promise<DoctorReport> {
  const [binary, path, update, home, secrets, hostChecks, crashes] = await Promise.all([
    checkBinary(),
    checkPath(),
    checkUpdate(),
    checkHome(),
    checkSecrets(),
    checkHostAndProviders(),
    checkCrashes(),
  ]);

  const checks = [
    binary,
    path,
    update,
    home,
    secrets,
    ...hostChecks,
    checkTerminal(mode.tty.stdout),
    crashes,
  ];

  const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };

  for (const check of checks) summary[check.status] += 1;

  return { version: VERSION, target: `${process.platform}-${process.arch}`, checks, summary };
}

/** One row per check, problems marked in the gutter, each fix on the line below at the value column; then the summary. */
export function renderDoctor(report: DoctorReport, presentation: Presentation): string[] {
  const rows: Row[] = [
    { label: "Version", value: `${report.version}, ${report.target}` },
    ...report.checks.flatMap((check): Row[] => [
      {
        gutter: GUTTERS[check.status],
        label: capitalize(check.id),
        value: check.detail,
      },
      ...(check.fix === undefined
        ? []
        : [
            {
              label: "",
              value: /^(nyte|chmod|chown) /u.test(check.fix) ? `Run: ${check.fix}` : check.fix,
            },
          ]),
    ]),
  ];

  const fail = report.summary.fail;
  const warn = report.summary.warn;

  return [
    ...formatRows(rows, presentation),
    "",
    fail === 0 && warn === 0
      ? "No problems found."
      : `${capitalize(count(fail, "problem"))}, ${count(warn, "warning")}.`,
  ];
}

/** Counts tui.log entries from the last week. Each entry starts with an ISO time. */
export async function recentCrashes(home: string, now = Date.now()): Promise<number> {
  const log = await readFile(join(home, "logs", "tui.log"), "utf8").catch(() => "");

  return [...log.matchAll(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) \[/gmu)].filter(
    ([, time]) => now - Date.parse(time ?? "") < CRASH_WINDOW_MS,
  ).length;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function count(amount: number, word: string): string {
  if (amount === 0) return `no ${word}s`;

  return `${String(amount)} ${word}${amount === 1 ? "" : "s"}`;
}

function tilde(path: string): string {
  const home = homedir();

  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function ok(id: string, detail: string): DoctorCheck {
  return { id, status: "ok", detail };
}

async function checkBinary(): Promise<DoctorCheck> {
  return compiled
    ? ok("binary", tilde(process.execPath))
    : ok("binary", `running from source with ${tilde(process.execPath)}`);
}

function onPath(name: string): string | undefined {
  for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
    if (directory !== "" && existsSync(join(directory, name))) return join(directory, name);
  }

  return undefined;
}

async function checkPath(): Promise<DoctorCheck> {
  const found = onPath("nyte");

  if (found === undefined) {
    return {
      id: "path",
      status: "warn",
      detail: "nyte isn't on PATH",
      fix: `Add ${tilde(join(nyteHome(), "bin"))} to PATH`,
    };
  }

  if (!compiled) return ok("path", `nyte resolves to ${tilde(found)}`);
  const [resolved, running] = await Promise.all([realpath(found), realpath(process.execPath)]);

  if (resolved === running) return ok("path", `nyte resolves to ${tilde(found)}`);
  const other = spawnSync(found, ["--version"], { encoding: "utf8", timeout: 5_000 });
  const version = other.status === 0 ? ` (${other.stdout.trim()})` : "";

  return {
    id: "path",
    status: "fail",
    detail: `nyte resolves to ${tilde(found)}${version}`,
    fix: `Remove ${tilde(found)}, or put ${tilde(join(nyteHome(), "bin"))} first on PATH`,
  };
}

async function checkUpdate(): Promise<DoctorCheck> {
  const off = ["NYTE_OFFLINE", "NYTE_SKIP_VERSION_CHECK"].find(
    (name) => process.env[name] !== undefined,
  );

  if (off !== undefined)
    return { id: "update", status: "skip", detail: `not checked: ${off} is set` };

  try {
    const notice = await findUpdate();

    return notice === undefined
      ? ok("update", `${VERSION}, no newer release`)
      : {
          id: "update",
          status: "warn",
          detail: `${notice.version} is available`,
          fix: "nyte update",
        };
  } catch (cause) {
    return { id: "update", status: "warn", detail: `couldn't check: ${errorMessage(cause)}` };
  }
}

async function checkHome(): Promise<DoctorCheck> {
  const home = nyteHome();

  if (!existsSync(home)) return ok("home", `${tilde(home)} is created on first run`);

  try {
    await access(home, constants.W_OK);

    return ok("home", `${tilde(home)} is writable`);
  } catch {
    return {
      id: "home",
      status: "fail",
      detail: `${tilde(home)} isn't writable`,
      fix: `chown -R "$USER" ${tilde(home)}`,
    };
  }
}

/** Checks secret files' modes with stat. Their contents are never read. */
async function checkSecrets(): Promise<DoctorCheck> {
  const home = nyteHome();
  const names = existsSync(home) ? secretFilesIn(await readdir(home)) : [];
  const open: string[] = [];

  for (const name of names) {
    const mode = (await stat(join(home, name))).mode & 0o777;

    if ((mode & 0o077) !== 0) open.push(`${name} is ${mode.toString(8).padStart(4, "0")}`);
  }

  if (open.length > 0) {
    return {
      id: "secrets",
      status: "fail",
      detail: `${open.join(", ")} (not opened)`,
      fix: `chmod 600 ${open.map((entry) => tilde(join(home, entry.split(" ")[0] ?? ""))).join(" ")}`,
    };
  }

  return ok(
    "secrets",
    names.length === 0 ? "none stored yet" : `${names.length} files, all 0600 (not opened)`,
  );
}

/** Asks the host `host.json` names for the model catalog. Never starts one: a missing host is a finding. */
async function checkHostAndProviders(): Promise<readonly DoctorCheck[]> {
  const running = await findRunningHost(hostFilePath());

  if (running === null)
    return [
      { id: "host", status: "warn", detail: "not running", fix: "nyte host" },
      { id: "providers", status: "skip", detail: "not checked without a running host" },
    ];

  return askHost(running).catch((cause: unknown): readonly DoctorCheck[] => [
    {
      id: "host",
      status: "fail",
      detail: `couldn't reach ${running.url}: ${errorMessage(cause)}`,
      fix: "nyte triage",
    },
    { id: "providers", status: "skip", detail: "not checked without a running host" },
  ]);
}

async function askHost(running: RunningHost): Promise<readonly DoctorCheck[]> {
  const started = Date.now();

  const host = await connectHost({
    kind: "attached",
    endpoint: { url: running.url, token: running.token },
  });

  try {
    const catalog = await host.connection.models.list();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const providers = [
      ...new Set(
        catalog.providers
          .filter((provider) => availableModels({ ...catalog, providers: [provider] }).length > 0)
          .map((provider) => provider.id),
      ),
    ];

    return [
      ok("host", `${running.url}, pid ${String(running.pid)}, answered in ${seconds}s`),
      providers.length > 0
        ? ok("providers", providers.join(", "))
        : { id: "providers", status: "fail", detail: "none has a credential", fix: "nyte login" },
    ];
  } finally {
    await host.close();
  }
}

function checkTerminal(stdoutTerminal: boolean): DoctorCheck {
  const stdout = process.stdout;
  const term = process.env["TERM"] ?? "unset";
  const program = process.env["TERM_PROGRAM"];
  const truecolor = /truecolor|24bit/u.test(process.env["COLORTERM"] ?? "");
  const size = stdoutTerminal ? `${stdout.columns}×${stdout.rows}` : "not a terminal";

  const detail = [
    program ?? `TERM=${term}`,
    size,
    truecolor ? "truecolor" : "256 colors or fewer",
  ].join(", ");

  if (term === "dumb")
    return {
      id: "terminal",
      status: "warn",
      detail: `${detail}; the full-screen app can't draw`,
      fix: "Set TERM to your terminal's type, such as xterm-256color",
    };

  if (stdoutTerminal && (stdout.columns ?? 80) < 80)
    return {
      id: "terminal",
      status: "warn",
      detail: `${detail}; the full-screen app needs 80 columns`,
      fix: "Widen the terminal to at least 80 columns",
    };

  return ok("terminal", detail);
}

async function checkCrashes(): Promise<DoctorCheck> {
  const crashes = await recentCrashes(nyteHome());

  return crashes === 0
    ? ok("crashes", "none in the last 7 days")
    : {
        id: "crashes",
        status: "warn",
        detail: `${crashes} in ${tilde(join(nyteHome(), "logs", "tui.log"))} in the last 7 days`,
        fix: "nyte triage",
      };
}
