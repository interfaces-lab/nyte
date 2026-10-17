import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { scheduler } from "node:timers/promises";
import { logPath } from "./registration.ts";

/** The launchd label of the installed service; a systemd unit is named `nyte.service`. */
const SERVICE_LABEL = "sh.nyte.service";

const SYSTEMD_UNIT = "nyte.service";

/** How long one supervisor command may run; `systemctl stop` waits for the service to exit. */
const COMMAND_TIMEOUT_MS = 60_000;

const UNLOAD_TIMEOUT_MS = 10_000;

/** How often an unload checks whether launchd has dropped the job. */
const UNLOAD_POLL_MS = 50;

/**
 * The service manager that runs the installed service for the user whose home is `home`:
 * a launch agent in the user's `gui/<uid>` domain on macOS, a systemd user unit on Linux.
 * `unit` is the file the supervisor loads.
 */
export type Supervisor =
  | { readonly kind: "launchd"; readonly unit: string; readonly domain: string }
  | { readonly kind: "systemd"; readonly unit: string };

/** The supervisor of `platform`, or undefined on a platform without launchd or systemd. */
export function findSupervisor(
  home: string,
  platform: NodeJS.Platform = process.platform,
): Supervisor | undefined {
  if (platform === "linux")
    return { kind: "systemd", unit: join(home, ".config", "systemd", "user", SYSTEMD_UNIT) };

  const uid = process.getuid?.();

  if (platform !== "darwin" || uid === undefined) return undefined;

  return {
    kind: "launchd",
    unit: join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
    domain: `gui/${String(uid)}`,
  };
}

/** Whether `home` has the service's unit installed for this platform's supervisor. */
export async function unitInstalled(home: string): Promise<boolean> {
  const supervisor = findSupervisor(home);

  return supervisor !== undefined && (await present(supervisor.unit));
}

/** What a unit runs: `command` in `home`, with `environment` as its whole environment. */
export interface UnitPlan {
  readonly home: string;
  readonly command: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * Renders the unit. Both supervisors start it at login, restart it when it crashes or exits
 * with a failure, leave it stopped after a clean exit (the one `nyte service stop` causes),
 * and append its output to the service log.
 */
export function renderUnit(supervisor: Supervisor, plan: UnitPlan): string {
  const log = logPath(plan.home);

  if (supervisor.kind === "systemd")
    return [
      "[Unit]",
      "Description=Nyte service",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${systemdValue(plan.home)}`,
      ...Object.entries(plan.environment).map(
        ([name, value]) => `Environment=${systemdValue(`${name}=${value}`)}`,
      ),
      `ExecStart=${plan.command.map((argument) => systemdValue(argument).replaceAll("$", "$$$$")).join(" ")}`,
      "Restart=on-failure",
      "RestartSec=5",
      `StandardOutput=append:${log.replaceAll("%", "%%")}`,
      `StandardError=append:${log.replaceAll("%", "%%")}`,
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${SERVICE_LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...plan.command.map((argument) => `    <string>${xml(argument)}</string>`),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...Object.entries(plan.environment).flatMap(([name, value]) => [
      `    <key>${xml(name)}</key>`,
      `    <string>${xml(value)}</string>`,
    ]),
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${xml(plan.home)}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${xml(log)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${xml(log)}</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

/** Writes the unit for `plan` and creates the log's directory; false when the unit already read exactly so. */
export async function writeUnit(supervisor: Supervisor, plan: UnitPlan): Promise<boolean> {
  const text = renderUnit(supervisor, plan);
  await mkdir(dirname(logPath(plan.home)), { recursive: true, mode: 0o700 });

  if ((await readFile(supervisor.unit, "utf8").catch(() => undefined)) === text) return false;
  await mkdir(dirname(supervisor.unit), { recursive: true });
  const temporary = `${supervisor.unit}.${String(process.pid)}.tmp`;

  try {
    await writeFile(temporary, text, { mode: 0o644 });
    await rename(temporary, supervisor.unit);
  } catch (cause) {
    await rm(temporary, { force: true });

    throw cause;
  }

  return true;
}

/** Starts the unit as written unless it already runs; loads it first when launchd hasn't. */
export async function startUnit(supervisor: Supervisor): Promise<void> {
  if (supervisor.kind === "systemd") {
    await required("systemctl", ["--user", "start", SYSTEMD_UNIT]);

    return;
  }

  await optional("launchctl", ["bootstrap", supervisor.domain, supervisor.unit]);
  await required("launchctl", ["kickstart", launchdTarget(supervisor)]);
}

/**
 * Stops the unit's service through the supervisor, so it can't restart the old command, waits
 * for `stopped` (which stops a service the supervisor doesn't run), then starts the unit as
 * written now and has it start at login.
 */
export async function relaunchUnit(
  supervisor: Supervisor,
  stopped: () => Promise<boolean>,
): Promise<void> {
  if (supervisor.kind === "systemd") {
    await required("systemctl", ["--user", "daemon-reload"]);
    await required("systemctl", ["--user", "enable", SYSTEMD_UNIT]);
    await optional("systemctl", ["--user", "stop", SYSTEMD_UNIT]);
    await stopped();
    await required("systemctl", ["--user", "start", SYSTEMD_UNIT]);

    return;
  }

  await unload(supervisor);
  await stopped();
  await required("launchctl", ["bootstrap", supervisor.domain, supervisor.unit]);
}

/** Stops the unit's service, unloads the unit and deletes it; false when it wasn't installed. */
export async function removeUnit(supervisor: Supervisor): Promise<boolean> {
  if (!(await present(supervisor.unit))) return false;

  if (supervisor.kind === "systemd")
    await optional("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
  else await unload(supervisor);
  await rm(supervisor.unit, { force: true });

  if (supervisor.kind === "systemd") await optional("systemctl", ["--user", "daemon-reload"]);

  return true;
}

/** The pid the supervisor runs the service as; null when the unit isn't loaded or its service isn't running. */
export async function supervisedPid(supervisor: Supervisor): Promise<number | null> {
  if (supervisor.kind === "systemd") {
    const shown = await run("systemctl", [
      "--user",
      "show",
      SYSTEMD_UNIT,
      "--property=MainPID",
      "--value",
    ]);

    const pid = Number(shown.stdout.trim());

    return shown.code === 0 && Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  const printed = await run("launchctl", ["print", launchdTarget(supervisor)]);
  const pid = /^\s*pid = (\d+)$/mu.exec(printed.stdout)?.[1];

  return printed.code === 0 && pid !== undefined ? Number(pid) : null;
}

/** Boots the job out of launchd and waits until launchd has dropped it, since a bootstrap while it drains fails. */
async function unload(supervisor: Extract<Supervisor, { kind: "launchd" }>): Promise<void> {
  const target = launchdTarget(supervisor);
  await optional("launchctl", ["bootout", target]);
  const deadline = Date.now() + UNLOAD_TIMEOUT_MS;

  while ((await run("launchctl", ["print", target])).code === 0) {
    if (Date.now() > deadline)
      throw new Error(`launchd didn't unload ${SERVICE_LABEL} within 10 s.`);
    await scheduler.wait(UNLOAD_POLL_MS);
  }
}

function launchdTarget(supervisor: Extract<Supervisor, { kind: "launchd" }>): string {
  return `${supervisor.domain}/${SERVICE_LABEL}`;
}

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a supervisor command; a command that can't start at all (not on PATH) throws. */
function run(command: string, args: readonly string[]): Promise<Ran> {
  return new Promise((settle, fail) => {
    execFile(command, args, { timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error !== null && !Number.isInteger(error.code)) {
        const message = error.killed
          ? `\`${[command, ...args].join(" ")}\` didn't finish within 60 s.`
          : `Couldn't run ${command}: ${error.message}`;

        fail(new Error(message, { cause: error }));

        return;
      }

      settle({ code: Number(error?.code ?? 0), stdout, stderr });
    });
  });
}

async function required(command: string, args: readonly string[]): Promise<void> {
  const ran = await run(command, args);

  if (ran.code !== 0)
    throw new Error(
      `\`${[command, ...args].join(" ")}\` failed (exit ${String(ran.code)})${ran.stderr.trim() === "" ? "." : `: ${ran.stderr.trim()}`}`,
    );
}

/** Runs a step whose failure only means there was nothing to do, such as unloading a job that isn't loaded. */
async function optional(command: string, args: readonly string[]): Promise<void> {
  await run(command, args);
}

async function present(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false;
}

function xml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Quotes one systemd value, escaping its `%` specifiers. */
function systemdValue(text: string): string {
  const escaped = text.replaceAll("%", "%%");

  return /[\s"'\\]/u.test(escaped)
    ? `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
    : escaped;
}
