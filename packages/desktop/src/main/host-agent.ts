import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { app } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { bundledHostAgentJob, hostAgentPlist } from "../shared/host-agent-job.ts";
import type { HostAgentJob } from "../shared/host-agent-job.ts";

const execute = promisify(execFile);

export type AgentRegistration = Electron.LoginItemSettings["status"];

export interface HostAgent {
  readonly label: string;
  start(): Promise<AgentRegistration>;
  registration(): Promise<AgentRegistration>;
  pid(): Promise<number | null>;
  restart(): Promise<void>;
}

export interface HostAgentOptions {
  readonly appId: string;
  readonly home: string;
  readonly nyteHome: string;
  readonly packaged: boolean;
  readonly resources: string;
  readonly appPath: string;
  readonly label: string | undefined;
}

export function hostAgent(options: HostAgentOptions): HostAgent {
  if (process.platform !== "darwin") return detachedHost(options);

  return options.packaged ? loginItemAgent(options.appId) : developmentAgent(options);
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}

function loginItemAgent(appId: string): HostAgent {
  const job = bundledHostAgentJob(appId);
  const service = { type: "agentService", serviceName: `${job.label}.plist` } as const;
  const registration = async (): Promise<AgentRegistration> =>
    app.getLoginItemSettings(service).status;

  return {
    label: job.label,
    async start() {
      app.setLoginItemSettings({ ...service, openAtLogin: true });

      return registration();
    },
    registration,
    pid: () => launchdPid(job.label),
    restart: () => kickstart(job.label),
  };
}

function developmentAgent(options: HostAgentOptions): HostAgent {
  const label = options.label ?? `${options.appId}.dev.host`;
  const path = join(options.home, "Library", "LaunchAgents", `${label}.plist`);

  const job: HostAgentJob = {
    label,
    program: { kind: "path", path: developmentBinary(options) },
    arguments: ["host"],
    environment: { HOME: options.home, NYTE_HOME: options.nyteHome },
    log: join(options.nyteHome, "logs", "host.log"),
  };

  const loaded = (): Promise<boolean> =>
    execute("launchctl", ["print", target(label)]).then(
      () => true,
      () => false,
    );

  const start = async (): Promise<AgentRegistration> => {
    const plist = hostAgentPlist(job);
    const written = await readFile(path, "utf8").catch(() => null);

    if (written === plist && (await loaded())) return "enabled";
    await mkdir(join(options.home, "Library", "LaunchAgents"), { recursive: true });
    await mkdir(join(options.nyteHome, "logs"), { recursive: true, mode: 0o700 });
    await writeFile(path, plist);
    await execute("launchctl", ["bootout", target(label)]).catch(() => undefined);
    await bootstrap(path);

    return "enabled";
  };

  return {
    label,
    start,
    registration: async () => ((await loaded()) ? "enabled" : "not-registered"),
    pid: () => launchdPid(label),
    async restart() {
      await start();
      await kickstart(label);
    },
  };
}

const RunningHostType = Type.Object({ pid: Type.Integer() });

function detachedHost(options: HostAgentOptions): HostAgent {
  const binary = options.packaged ? join(options.resources, "nyte") : developmentBinary(options);
  const label = options.label ?? `${options.appId}.host`;

  const pid = async (): Promise<number | null> => {
    const text = await readFile(join(options.nyteHome, "host.json"), "utf8").catch(() => null);
    const parsed: unknown = text === null ? null : JSON.parse(text);

    return Value.Check(RunningHostType, parsed) && processAlive(parsed.pid) ? parsed.pid : null;
  };

  const start = async (): Promise<AgentRegistration> => {
    if (process.platform === "win32") return "not-found";

    if ((await pid()) !== null) return "enabled";
    spawn(binary, ["host", "--log"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, HOME: options.home, NYTE_HOME: options.nyteHome },
    }).unref();

    return "enabled";
  };

  return {
    label,
    start,
    registration: async () => (process.platform === "win32" ? "not-found" : "enabled"),
    pid,
    async restart() {
      const running = await pid();

      if (running !== null) process.kill(running, "SIGTERM");
      await stopped(pid);
      await start();
    },
  };
}

async function stopped(pid: () => Promise<number | null>): Promise<void> {
  for (let attempt = 0; attempt < 50 && (await pid()) !== null; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100));
}

function developmentBinary(options: HostAgentOptions): string {
  return join(options.appPath, "..", "tui", "dist", "nyte");
}

async function bootstrap(path: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const failed = await execute("launchctl", ["bootstrap", domain(), path]).then(
      () => null,
      (cause: unknown) => cause,
    );

    if (failed === null) return;

    if (attempt === 10) throw failed;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function launchdPid(label: string): Promise<number | null> {
  const printed = await execute("launchctl", ["print", target(label)]).catch(() => null);
  const found = printed === null ? undefined : /^\s*pid = (\d+)$/mu.exec(printed.stdout)?.[1];

  return found === undefined ? null : Number(found);
}

async function kickstart(label: string): Promise<void> {
  await execute("launchctl", ["kickstart", "-k", target(label)]);
}

function domain(): string {
  const uid = process.getuid?.();

  if (uid === undefined) throw new Error("launchd needs a user id.");

  return `gui/${String(uid)}`;
}

function target(label: string): string {
  return `${domain()}/${label}`;
}
