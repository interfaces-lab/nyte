import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { app } from "electron";
import { processAlive, readHostFile } from "@nyte-ai/service/host-endpoint";
import {
  bundledHostAgentJob,
  developmentHostAgentJob,
  hostAgentPlist,
} from "../shared/host-agent-job.ts";
import { PACKAGED_BUILDS } from "../shared/desktop-builds.ts";
import type { PackagedBuild } from "../shared/desktop-builds.ts";

const execute = promisify(execFile);

export type AgentRegistration = Electron.LoginItemSettings["status"];

export interface ServingHost {
  readonly pid: number;
  readonly own: boolean;
}

export interface HostAgent {
  readonly label: string;
  start(): Promise<AgentRegistration>;
  registration(): Promise<AgentRegistration>;
  pid(): Promise<number | null>;
  serving(): Promise<ServingHost | null>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export interface HostAgentOptions {
  readonly build: PackagedBuild | null;
  readonly home: string;
  readonly nyteHome: string;
  readonly appPath: string;
  readonly executable: string;
  readonly entry: string;
  readonly label: string | undefined;
}

export function hostAgent(options: HostAgentOptions): HostAgent {
  if (process.platform !== "darwin" || options.build?.host === "detached")
    return detachedHost(options);

  return options.build === null ? developmentAgent(options) : loginItemAgent(options);
}

export async function processStarted(pid: number): Promise<number | null> {
  const printed = await execute("ps", ["-o", "lstart=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C" },
  }).catch(() => null);

  const started = printed === null ? Number.NaN : Date.parse(printed.stdout.trim());

  return Number.isNaN(started) ? null : started;
}

function loginItemAgent(options: HostAgentOptions): HostAgent {
  const job = bundledHostAgentJob({
    appId: appId(options),
    executable: basename(options.executable),
  });

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
    serving: () => servingHost(options.nyteHome, job.label),
    restart: () => replaceHost(options, job.label),
    async stop() {
      app.setLoginItemSettings({ ...service, openAtLogin: false });
    },
  };
}

function developmentAgent(options: HostAgentOptions): HostAgent {
  const label = options.label ?? `${appId(options)}.dev.host`;
  const path = join(options.home, "Library", "LaunchAgents", `${label}.plist`);

  const job = developmentHostAgentJob({
    label,
    executable: options.executable,
    entry: options.entry,
    tailnet: developmentTailnet(options),
    home: options.home,
    nyteHome: options.nyteHome,
    environment: process.env,
  });

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
    serving: () => servingHost(options.nyteHome, label),
    async restart() {
      await start();
      await replaceHost(options, label);
    },
    async stop() {
      await execute("launchctl", ["bootout", target(label)]).catch(() => undefined);
    },
  };
}

async function replaceHost(options: HostAgentOptions, label: string): Promise<void> {
  const serving = await servedPid(options.nyteHome);

  if (serving !== null && serving !== (await launchdPid(label))) {
    process.kill(serving, "SIGTERM");

    return;
  }

  await kickstart(label);
}

async function servingHost(nyteHome: string, label: string): Promise<ServingHost | null> {
  const pid = await servedPid(nyteHome);

  return pid === null ? null : { pid, own: pid === (await launchdPid(label)) };
}

async function servedPid(nyteHome: string): Promise<number | null> {
  const host = await readHostFile(join(nyteHome, "host.json"));

  return host !== null && processAlive(host.pid) ? host.pid : null;
}

function detachedHost(options: HostAgentOptions): HostAgent {
  const label = options.label ?? `${appId(options)}.host`;
  const pid = (): Promise<number | null> => servedPid(options.nyteHome);

  const launch = (): void =>
    spawn(
      options.executable,
      [
        options.entry,
        "--log",
        ...(options.build === null ? ["--tailnet", developmentTailnet(options)] : []),
      ],
      {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          HOME: options.home,
          NYTE_HOME: options.nyteHome,
        },
      },
    ).unref();

  const start = async (): Promise<AgentRegistration> => {
    if (process.platform === "win32") return "not-found";

    if ((await pid()) !== null) return "enabled";
    launch();

    return "enabled";
  };

  const stop = async (): Promise<void> => {
    const running = await pid();

    if (running !== null) process.kill(running, "SIGTERM");
    await stopped(pid);
  };

  return {
    label,
    start,
    registration: async () => (process.platform === "win32" ? "not-found" : "enabled"),
    pid,
    async serving() {
      const running = await pid();

      return running === null ? null : { pid: running, own: false };
    },
    async restart() {
      await stop();

      if (process.platform !== "win32") launch();
    },
    stop,
  };
}

async function stopped(pid: () => Promise<number | null>): Promise<void> {
  for (let attempt = 0; attempt < 50 && (await pid()) !== null; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100));
}

function appId(options: HostAgentOptions): string {
  return (options.build ?? PACKAGED_BUILDS.production).appId;
}

function developmentTailnet(options: HostAgentOptions): string {
  return join(options.appPath, "..", "tui", "dist", "nyte-tailnet");
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
