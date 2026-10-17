/**
 * Stands in for `launchctl` and `systemctl --user` on PATH: loads the unit the service wrote,
 * runs its command detached with the unit's environment, directory and log, and answers
 * `print` and `show` with the pid it runs. Every call is appended to `calls.log` in
 * `FAKE_SUPERVISOR_STATE`; a systemd unit is read from `FAKE_SUPERVISOR_UNIT`.
 * Run as `node fake-supervisor.ts launchctl|systemctl <args...>`.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const [tool = "", ...args] = process.argv.slice(2);

const state = process.env["FAKE_SUPERVISOR_STATE"] ?? "";

const loaded = join(state, "loaded");

const pidFile = join(state, "pid");

appendFileSync(join(state, "calls.log"), `${[tool, ...args].join(" ")}\n`);

interface Unit {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly log: string;
}

function readPlist(path: string): Unit {
  const text = readFileSync(path, "utf8");

  const strings = (block: string): string[] =>
    [...block.matchAll(/<string>([^<]*)<\/string>/gu)].map((match) => unescape(match[1] ?? ""));

  const program = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(text)?.[1];

  const environment = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/u.exec(
    text,
  )?.[1];

  const keys = [...(environment ?? "").matchAll(/<key>([^<]*)<\/key>/gu)].map((match) => match[1]);
  const values = strings(environment ?? "");

  return {
    command: strings(program ?? ""),
    cwd: unescape(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)</u.exec(text)?.[1] ?? "/"),
    env: Object.fromEntries(keys.map((key, at) => [key ?? "", values[at] ?? ""])),
    log: unescape(/<key>StandardOutPath<\/key>\s*<string>([^<]*)</u.exec(text)?.[1] ?? ""),
  };
}

function readSystemdUnit(path: string): Unit {
  const text = readFileSync(path, "utf8");

  const field = (name: string): string[] =>
    [...text.matchAll(new RegExp(`^${name}=(.*)$`, "gmu"))].map((match) => match[1] ?? "");

  const words = (value: string): string[] =>
    [...value.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/gu)].map((match) =>
      (match[1] ?? match[2] ?? "")
        .replaceAll('\\"', '"')
        .replaceAll("\\\\", "\\")
        .replaceAll("%%", "%"),
    );

  return {
    command: words(field("ExecStart")[0] ?? "").map((word) => word.replaceAll("$$", "$")),
    cwd: words(field("WorkingDirectory")[0] ?? "/")[0] ?? "/",
    env: Object.fromEntries(
      field("Environment").map((assignment) => {
        const [pair = ""] = words(assignment);
        const at = pair.search("=");

        return [pair.slice(0, at), pair.slice(at + 1)];
      }),
    ),
    log: (field("StandardOutput")[0] ?? "").replace(/^append:/u, "").replaceAll("%%", "%"),
  };
}

function unescape(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function running(): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, "utf8"));

  try {
    process.kill(pid, 0);

    return pid;
  } catch {
    return undefined;
  }
}

function launch(unit: Unit): void {
  const [command = "", ...rest] = unit.command;
  const output = openSync(unit.log, "a");

  const child = spawn(command, rest, {
    cwd: unit.cwd,
    env: unit.env,
    detached: true,
    stdio: ["ignore", output, output],
  });

  child.unref();
  writeFileSync(pidFile, String(child.pid));
}

async function stop(): Promise<void> {
  const pid = running();

  if (pid === undefined) return;
  process.kill(pid, "SIGTERM");

  while (running() !== undefined) await sleep(20);
}

async function launchctl(): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case "bootstrap": {
      if (existsSync(loaded)) return 37;
      const plist = rest[1] ?? "";
      writeFileSync(loaded, plist);
      launch(readPlist(plist));

      return 0;
    }

    case "kickstart": {
      if (!existsSync(loaded)) return 113;

      if (rest.includes("-k")) await stop();

      if (running() === undefined) launch(readPlist(readFileSync(loaded, "utf8")));

      return 0;
    }

    case "bootout":
      if (!existsSync(loaded)) return 113;
      rmSync(loaded);
      await stop();

      return 0;
    case "print": {
      if (!existsSync(loaded)) return 113;
      const pid = running();
      process.stdout.write(
        pid === undefined
          ? "\tstate = not running\n"
          : `\tstate = running\n\tpid = ${String(pid)}\n`,
      );

      return 0;
    }

    default:
      return 1;
  }
}

async function systemctl(): Promise<number> {
  const [scope, command, ...rest] = args;
  const unit = process.env["FAKE_SUPERVISOR_UNIT"] ?? "";

  if (scope !== "--user") return 1;

  switch (command) {
    case "daemon-reload":
      return 0;
    case "enable":
      writeFileSync(loaded, unit);

      return 0;
    case "disable":
      rmSync(loaded, { force: true });

      if (rest.includes("--now")) await stop();

      return 0;
    case "start":
      if (running() === undefined) launch(readSystemdUnit(unit));

      return 0;
    case "stop":
      await stop();

      return 0;
    case "show":
      process.stdout.write(`${String(running() ?? 0)}\n`);

      return 0;
    default:
      return 1;
  }
}

process.exitCode = tool === "launchctl" ? await launchctl() : await systemctl();
