import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { alignedRows, ansiEnabled, bold, dim, statusGlyph } from "./cli-style.ts";
import { compiled } from "./compiled.ts";
import { availableModels } from "./lib/catalog.ts";
import { errorMessage } from "./lib/format.ts";
import { connectHost } from "./local-host.ts";
import { secretFilesIn } from "./secrets.ts";
import { VERSION, checkForUpdate } from "./version.ts";

export type CheckStatus = "ok" | "warn" | "fail";

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

export function nyteHome(): string {
  return process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");
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
      fix: `add ${tilde(join(nyteHome(), "bin"))} to PATH`,
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
    fix: `remove ${tilde(found)}, or put ${tilde(join(nyteHome(), "bin"))} first on PATH`,
  };
}

async function checkUpdate(): Promise<DoctorCheck> {
  const skip = ["NYTE_OFFLINE", "NYTE_SKIP_VERSION_CHECK"].find(
    (name) => process.env[name] !== undefined,
  );

  if (skip !== undefined)
    return { id: "update", status: "warn", detail: `not checked: ${skip} is set` };

  try {
    const notice = await checkForUpdate();

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

/** Starts a host on the real store, asks it for the model catalog, and closes it. */
async function checkHostAndProviders(): Promise<readonly DoctorCheck[]> {
  const started = Date.now();
  let host;

  try {
    host = await connectHost({ kind: "local" });
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
      ok("host", `started on ${tilde(join(nyteHome(), "nyte.db"))}, answered in ${seconds}s`),
      providers.length > 0
        ? ok("providers", providers.join(", "))
        : { id: "providers", status: "fail", detail: "none has a credential", fix: "nyte login" },
    ];
  } catch (cause) {
    return [
      {
        id: "host",
        status: "fail",
        detail: `couldn't start: ${errorMessage(cause)}`,
        fix: "nyte triage",
      },
      { id: "providers", status: "warn", detail: "unknown without a host" },
    ];
  } finally {
    await host?.close().catch(() => undefined);
  }
}

function checkTerminal(): DoctorCheck {
  const stdout = process.stdout;
  const term = process.env["TERM"] ?? "unset";
  const program = process.env["TERM_PROGRAM"];
  const truecolor = /truecolor|24bit/u.test(process.env["COLORTERM"] ?? "");
  const size = stdout.isTTY ? `${stdout.columns}×${stdout.rows}` : "not a terminal";

  const detail = [
    program ?? `TERM=${term}`,
    size,
    truecolor ? "truecolor" : "256 colors or fewer",
  ].join(", ");

  const narrow = stdout.isTTY && (stdout.columns ?? 80) < 80;

  return term === "dumb" || narrow
    ? { id: "terminal", status: "warn", detail }
    : ok("terminal", detail);
}

/** Counts tui.log entries from the last week. Each entry starts with an ISO time. */
export async function recentCrashes(home: string, now = Date.now()): Promise<number> {
  const log = await readFile(join(home, "logs", "tui.log"), "utf8").catch(() => "");

  return [...log.matchAll(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) \[/gmu)].filter(
    ([, time]) => now - Date.parse(time ?? "") < CRASH_WINDOW_MS,
  ).length;
}

async function checkCrashes(): Promise<DoctorCheck> {
  const count = await recentCrashes(nyteHome());

  return count === 0
    ? ok("crashes", "none in the last 7 days")
    : {
        id: "crashes",
        status: "warn",
        detail: `${count} in ${tilde(join(nyteHome(), "logs", "tui.log"))} in the last 7 days`,
        fix: "nyte triage",
      };
}

/** Runs every check. Changes nothing: the host check starts a host and closes it. */
export async function runDoctor(): Promise<DoctorReport> {
  const [binary, path, update, home, secrets, hostChecks, crashes] = await Promise.all([
    checkBinary(),
    checkPath(),
    checkUpdate(),
    checkHome(),
    checkSecrets(),
    checkHostAndProviders(),
    checkCrashes(),
  ]);

  const checks = [binary, path, update, home, secrets, ...hostChecks, checkTerminal(), crashes];
  const summary = { ok: 0, warn: 0, fail: 0 };

  for (const check of checks) summary[check.status] += 1;

  return { version: VERSION, target: `${process.platform}-${process.arch}`, checks, summary };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function renderDoctor(report: DoctorReport, color: boolean): string {
  const width = Math.max(...report.checks.map((check) => check.id.length));

  const lines = [
    `${bold("nyte doctor", color)}  ${dim(`${report.version} · ${report.target}`, color)}`,
    "",
  ];

  for (const check of report.checks) {
    const [row] = alignedRows([{ label: check.id, detail: check.detail }], color, width);
    lines.push(`  ${statusGlyph(check.status, color)} ${row?.slice(2) ?? ""}`);

    if (check.fix !== undefined) {
      const prefix = check.fix.startsWith("nyte") || check.fix.startsWith("chmod") ? "run: " : "";
      lines.push(`${" ".repeat(width + 6)}${dim(`${prefix}${check.fix}`, color)}`);
    }
  }

  const { fail, warn } = report.summary;
  lines.push(
    "",
    fail === 0 && warn === 0
      ? "No problems found."
      : `${plural(fail, "problem")}, ${plural(warn, "warning")}.`,
  );

  if (
    existsSync(join(process.cwd(), "pnpm-workspace.yaml")) &&
    existsSync(join(process.cwd(), "packages", "tui"))
  ) {
    lines.push(
      dim("This is a nyte checkout. For the dev setup, run: npx nyte-ai init --check", color),
    );
  }

  return lines.join("\n");
}

export async function doctorCommand(args: readonly string[]): Promise<number> {
  const json = args.includes("--json");

  if (args.some((arg) => arg !== "--json")) throw new Error("Usage: nyte doctor [--json]");
  const report = await runDoctor();

  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else process.stdout.write(`${renderDoctor(report, ansiEnabled())}\n`);

  return report.summary.fail > 0 ? 1 : 0;
}
