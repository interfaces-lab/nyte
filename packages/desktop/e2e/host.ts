import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ModelRef } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import { sdk } from "@nyte-ai/sdk";
import {
  DESKTOP_APP_IDS,
  developmentHostAgentJob,
  hostAgentPlist,
} from "../src/shared/host-agent-job.ts";
import { e2eAnswers } from "../src/host/fixtures/e2e-models.ts";
import { POLISH_MODEL, polishModel, serveScriptedModel } from "./polish-fixture.ts";

const execute = promisify(execFile);

const DESKTOP_ROOT = resolve(import.meta.dirname, "..");

const TUI_ROOT = resolve(DESKTOP_ROOT, "../tui");

/** How long the host has to answer on its socket after launchd starts it, and to exit after `bootout`. */
const HOST_MS = 30_000;

export const E2E_MODEL: ModelRef = { provider: "anthropic", id: POLISH_MODEL };

const RunningHostType = Type.Object({ pid: Type.Integer() });

const JsonObjectType = Type.Record(Type.String(), Type.Unknown());

export interface E2eHostOptions {
  readonly home: string;
  /** Where the app resolves its development tailnet sidecar: `<parent>/tui/dist/nyte-tailnet`, as `app.getAppPath()/../tui` resolves it. */
  readonly parentDirectory: string;
  readonly places?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly output: string[];
}

export interface E2eHost {
  readonly label: string;
  /** The variables the app needs to find this host's launchd job and generate the same plist. */
  readonly environment: Readonly<Record<string, string>>;
  pid(): Promise<number | null>;
  /** Stops the host process for `ms`, so the app finds it held. */
  hold(ms: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts the e2e build's host for `home` as its own launchd job, as the app's development agent would, over
 * the scripted catalog served at a local Anthropic endpoint. The app launched with
 * `environment` finds the same job loaded and only connects to its socket.
 */
export async function startE2eHost(options: E2eHostOptions): Promise<E2eHost> {
  const nyteHome = join(options.home, ".nyte");
  const log = (line: string): number => options.output.push(`${line}\n`);

  const endpoint = await serveScriptedModel(
    e2eAnswers({ home: options.home, places: options.places, log }),
  );

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => endpoint.close());
  await signIn(options.home, endpoint.origin);

  const label = `${DESKTOP_APP_IDS.production}.e2e.${String(process.pid)}.${String(Date.now())}`;

  const environment = {
    ...options.environment,
    NYTE_MODELS_URL: `${endpoint.origin}/catalog`,
    NYTE_SKIP_VERSION_CHECK: "1",
    NYTE_DESKTOP_HOST_LABEL: label,
  };

  const job = developmentHostAgentJob({
    label,
    executable: await realpath(await electronExecutable()),
    entry: await realpath(join(DESKTOP_ROOT, "out-e2e", "main", "nyte-host.js")),
    tailnet: join(options.parentDirectory, "tui", "dist", "nyte-tailnet"),
    home: options.home,
    nyteHome,
    environment,
  });

  await ensureTuiLink(options.parentDirectory);
  const agents = join(options.home, "Library", "LaunchAgents");
  const plist = join(agents, `${label}.plist`);
  await mkdir(agents, { recursive: true });
  await mkdir(join(nyteHome, "logs"), { recursive: true, mode: 0o700 });
  await writeFile(join(nyteHome, "logs", "host.log"), "", { flag: "a" });
  await writeFile(plist, hostAgentPlist(job));
  await execute("launchctl", ["bootstrap", domain(), plist]);
  cleanup.defer(() => bootout(label));

  const tail = spawn("tail", ["-n", "+1", "-F", join(nyteHome, "logs", "host.log")], {
    stdio: ["ignore", "pipe", "ignore"],
  });

  tail.stdout.setEncoding("utf8");
  tail.stdout.on("data", (chunk: string) => options.output.push(chunk));
  cleanup.defer(() => void tail.kill());

  const pid = (): Promise<number | null> => runningHost(nyteHome);
  await waitFor(async () => (await pid()) !== null, `the host for ${options.home} to answer`);
  const owned = cleanup.move();

  return {
    label,
    environment,
    pid,
    async hold(ms) {
      const held = await pid();

      if (held === null) throw new Error("There is no host to hold.");
      process.kill(held, "SIGSTOP");
      setTimeout(() => resume(held), ms).unref();
    },
    async close() {
      await owned.disposeAsync();
      await rm(plist, { force: true });
    },
  };
}

/** Signs `home` in to the scripted Anthropic endpoint with a key and picks its model, through the store the host opens. */
async function signIn(home: string, origin: string): Promise<void> {
  const models = join(home, ".nyte", "models-store.json");
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });

  const stored: Readonly<Record<string, unknown>> = await readFile(models, "utf8").then(
    (text) => Value.Parse(JsonObjectType, JSON.parse(text)),
    () => ({}),
  );

  const catalogs = Value.Check(JsonObjectType, stored["rawCatalogs"]) ? stored["rawCatalogs"] : {};

  await writeFile(
    models,
    JSON.stringify({
      ...stored,
      rawCatalogs: {
        ...catalogs,
        anthropic: { checkedAt: Date.now(), models: [polishModel(origin)] },
      },
    }),
  );

  const previous = process.env.NYTE_MODELS_URL;
  process.env.NYTE_MODELS_URL = `${origin}/catalog`;
  dev.off();

  try {
    const host = await sdk.open({ home, workspace: { kind: "local", path: home } });

    try {
      const login = host.models.login({
        provider: "anthropic",
        method: { kind: "key" },
        label: "E2E",
      });

      for await (const step of login.steps())
        if (step.kind === "paste") await login.answer("sk-e2e");
      await host.models.setDefault(E2E_MODEL);
    } finally {
      await host.close();
    }
  } finally {
    if (previous === undefined) delete process.env.NYTE_MODELS_URL;
    else process.env.NYTE_MODELS_URL = previous;
  }
}

/** The Electron binary the e2e app and its host run. */
export async function electronExecutable(): Promise<string> {
  const electronRoot = join(DESKTOP_ROOT, "node_modules/electron");
  const executable = await readFile(join(electronRoot, "path.txt"), "utf8");

  return join(electronRoot, "dist", executable.trim());
}

async function ensureTuiLink(parent: string): Promise<void> {
  await symlink(TUI_ROOT, join(parent, "tui"), "junction").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "EEXIST") throw cause;
  });
}

async function runningHost(nyteHome: string): Promise<number | null> {
  const [text, socket] = await Promise.all([
    readFile(join(nyteHome, "host.json"), "utf8").catch(() => null),
    stat(join(nyteHome, "host.sock")).then(
      (found) => found.isSocket(),
      () => false,
    ),
  ]);

  const parsed: unknown = text === null ? null : JSON.parse(text);

  return socket && Value.Check(RunningHostType, parsed) && alive(parsed.pid) ? parsed.pid : null;
}

async function bootout(label: string): Promise<void> {
  const printed = await execute("launchctl", ["print", `${domain()}/${label}`]).catch(() => null);
  const found = /^\s*pid = (\d+)$/mu.exec(printed?.stdout ?? "")?.[1];
  await execute("launchctl", ["bootout", `${domain()}/${label}`]).catch(() => undefined);

  if (found === undefined) return;
  const pid = Number(found);
  resume(pid);
  const gone = await waitFor(async () => !alive(pid), `the host ${found} to exit`).then(
    () => true,
    () => false,
  );

  if (gone) return;
  process.kill(pid, "SIGKILL");

  throw new Error(`The host ${found} outlived its launchd job's bootout.`);
}

function resume(pid: number): void {
  if (alive(pid)) process.kill(pid, "SIGCONT");
}

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = performance.now() + HOST_MS;

  while (!(await check())) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}

function domain(): string {
  return `gui/${String(process.getuid?.() ?? 0)}`;
}
