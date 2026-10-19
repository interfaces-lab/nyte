import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ModelServer } from "./model-server.ts";

export interface Build {
  readonly label: string;
  readonly root: string;
}

const AGENTS = join(import.meta.dirname, "..", "..", "..", "tui", "qa", "harness");

const BUN = process.env.NYTE_BUN ?? "bun";

function requireRoot(name: string): string {
  const root = process.env[name];

  if (root === undefined || root === "") throw new Error(`Set ${name} to a built Nyte checkout.`);

  return resolve(root);
}

export function oldBuild(): Build {
  return { label: process.env.NYTE_OLD_LABEL ?? "old", root: requireRoot("NYTE_OLD_ROOT") };
}

export function newBuild(): Build {
  return { label: process.env.NYTE_NEW_LABEL ?? "new", root: requireRoot("NYTE_NEW_ROOT") };
}

export interface Home extends AsyncDisposable {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly store: string;
  readonly env: Readonly<Record<string, string>>;
}

const KEPT = ["PATH", "SHELL", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "TERM"];

export async function makeHome(parent: string, model: ModelServer): Promise<Home> {
  const root = await mkdtemp(join(parent, "home-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(home, ".zshrc"), "");
  await writeFile(
    join(home, ".nyte", "models-store.json"),
    JSON.stringify({
      rawCatalogs: { anthropic: { checkedAt: Date.now(), models: [model.model] } },
    }),
  );

  const kept = Object.fromEntries(
    KEPT.flatMap((name) => {
      const value = process.env[name];

      return value === undefined ? [] : [[name, value]];
    }),
  );

  const env = {
    ...kept,
    HOME: home,
    USERPROFILE: home,
    NYTE_MODELS_URL: `${model.origin}/catalog`,
    NYTE_SKIP_VERSION_CHECK: "1",
    NYTE_OFFLINE: "1",
  };

  return {
    root,
    home,
    cwd,
    store: join(home, ".nyte", "nyte.db"),
    env,
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function agentScript(build: Build, name: string): Promise<string> {
  const folder = join(build.root, "packages", "tui", "node_modules", ".nyte-harness");
  await mkdir(folder, { recursive: true });
  const target = join(folder, name);
  await copyFile(join(AGENTS, name), target);

  return target;
}

export interface Exited {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Spawned {
  readonly child: ChildProcess;
  readonly pid: number;
  output(): string;
  readonly exited: Promise<Exited>;
}

export function spawnIn(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
): Spawned {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => (stdout += chunk));
  child.stderr?.on("data", (chunk: string) => (stderr += chunk));

  const exited = new Promise<Exited>((done) => {
    child.once("close", (code, signal) => done({ code, signal, stdout, stderr }));
  });

  if (child.pid === undefined) throw new Error(`${command} did not start.`);

  return { child, pid: child.pid, output: () => `${stdout}${stderr}`, exited };
}

export async function seed(build: Build, home: Home): Promise<void> {
  const script = await agentScript(build, "seed.ts");
  const seeded = await spawnIn(BUN, [script], { cwd: home.cwd, env: home.env }).exited;

  if (seeded.code !== 0)
    throw new Error(`Seeding with ${build.label} failed:\n${seeded.stdout}${seeded.stderr}`);
}

export function binary(build: Build): string {
  return join(build.root, "packages", "tui", "src", "binary.ts");
}

export function print(build: Build, home: Home, args: readonly string[]): Spawned {
  return spawnIn(BUN, [binary(build), "-p", ...args], { cwd: home.cwd, env: home.env });
}

export function member(build: Build, home: Home): Spawned {
  return spawnIn(BUN, [binary(build), "serve", "--port", "0", "--token", "harness-member-token"], {
    cwd: home.cwd,
    env: home.env,
  });
}

export interface Terminal extends AsyncDisposable {
  readonly pid: number;
  readonly build: Build;
  screen(): Promise<string>;
  type(text: string): Promise<void>;
  enter(): Promise<void>;
  waitFor(text: string | RegExp, timeoutMs?: number): Promise<string>;
  kill(signal?: NodeJS.Signals): void;
  exited(): Promise<Exited>;
}

const DriverReplySchema = Type.Object({
  id: Type.Number(),
  ok: Type.Boolean(),
  screen: Type.Optional(Type.String()),
  pid: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
});

export async function openTerminal(
  build: Build,
  home: Home,
  args: readonly string[] = [],
): Promise<Terminal> {
  const driver = join(AGENTS, "tui-driver.ts");

  const spawned = spawnIn(
    BUN,
    [
      driver,
      JSON.stringify({ bun: BUN, binary: binary(build), args, cwd: home.cwd, env: home.env }),
    ],
    { cwd: AGENTS, env: { ...home.env, PATH: process.env.PATH ?? "" } },
  );

  const waiting = new Map<
    number,
    (reply: { ok: boolean; screen?: string; pid?: number; error?: string }) => void
  >();

  let next = 0;
  let buffered = "";

  spawned.child.stdout?.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      const parsed: unknown = JSON.parse(line);

      if (!Value.Check(DriverReplySchema, parsed)) continue;
      waiting.get(parsed.id)?.(parsed);
      waiting.delete(parsed.id);
    }
  });

  const ask = (message: Record<string, unknown>, timeoutMs = 30_000) =>
    new Promise<{ ok: boolean; screen?: string; pid?: number; error?: string }>((done, fail) => {
      const id = next;
      next += 1;

      const timer = setTimeout(
        () =>
          fail(
            new Error(
              `The TUI driver did not answer ${JSON.stringify(message)}.\n${spawned.output()}`,
            ),
          ),
        timeoutMs + 5_000,
      );

      waiting.set(id, (reply) => {
        clearTimeout(timer);
        done(reply);
      });
      spawned.child.stdin?.write(`${JSON.stringify({ id, ...message })}\n`);
    });

  const started = await ask({ kind: "pid" });
  const pid = started.pid ?? 0;

  return {
    pid,
    build,
    screen: async () => (await ask({ kind: "screen" })).screen ?? "",
    async type(text) {
      await ask({ kind: "type", text });
    },
    async enter() {
      await ask({ kind: "type", text: "\r" });
    },
    async waitFor(text, timeoutMs = 20_000) {
      const reply = await ask(
        typeof text === "string"
          ? { kind: "wait", text, timeoutMs }
          : { kind: "wait", pattern: text.source, flags: text.flags, timeoutMs },
        timeoutMs,
      );

      if (!reply.ok)
        throw new Error(
          `${build.label} TUI never showed ${String(text)}:\n${reply.screen ?? reply.error ?? ""}`,
        );

      return reply.screen ?? "";
    },
    kill(signal = "SIGKILL") {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
    },
    exited: async () => {
      await ask({ kind: "exited" }, 60_000);

      return spawned.exited;
    },
    async [Symbol.asyncDispose]() {
      await ask({ kind: "close" }, 10_000).catch(() => undefined);
      spawned.child.kill("SIGKILL");
      await spawned.exited;
    },
  };
}

export interface Desktop extends AsyncDisposable {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly build: Build;
  readonly output: readonly string[];
  hostPid(): Promise<number | undefined>;
}

async function electronExecutable(build: Build): Promise<string> {
  const electron = join(build.root, "packages", "desktop", "node_modules", "electron");

  return join(electron, "dist", (await readFile(join(electron, "path.txt"), "utf8")).trim());
}

export async function launchDesktop(
  build: Build,
  home: Home,
  options: { readonly appData?: string } = {},
): Promise<Desktop> {
  const desktop = join(build.root, "packages", "desktop");
  const main = join(desktop, "out", "main", "index.js");
  await access(main).catch(() => {
    throw new Error(
      `${build.label} has no desktop build at ${main}. Run pnpm --dir packages/desktop build there.`,
    );
  });
  const shell = await mkdtemp(join(home.root, "desktop-"));
  const appData = options.appData ?? join(shell, "app-data");
  await mkdir(appData, { recursive: true });
  await writeFile(
    join(shell, "environment.mjs"),
    `import { app } from "electron";\napp.setPath("appData", ${JSON.stringify(appData)});\napp.setPath("userData", ${JSON.stringify(join(appData, "user-data"))});\n`,
  );
  await writeFile(
    join(shell, "entry.mjs"),
    `import "./environment.mjs";\nimport ${JSON.stringify(pathToFileURL(main).href)};\n`,
  );

  const metadata = Value.Parse(
    Type.Object({ name: Type.String(), version: Type.String() }),
    JSON.parse(await readFile(join(desktop, "package.json"), "utf8")),
  );

  await writeFile(
    join(shell, "package.json"),
    JSON.stringify({ name: metadata.name, version: metadata.version, main: "entry.mjs" }),
  );
  await symlink(join(desktop, "resources"), join(shell, "resources"), "junction");

  const application = await _electron.launch({
    executablePath: await electronExecutable(build),
    args: [shell, "--use-mock-keychain", "--password-store=basic"],
    cwd: desktop,
    env: { ...home.env },
    timeout: 60_000,
  });

  const output: string[] = [];
  const child = application.process();

  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => output.push(chunk));
  }

  const page = await application.firstWindow();
  await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 60_000 });

  return {
    application,
    page,
    build,
    output,
    hostPid: () =>
      application.evaluate(
        ({ app }) => app.getAppMetrics().find((metric) => metric.name === "Nyte Host")?.pid,
      ),
    async [Symbol.asyncDispose]() {
      await application.close().catch(() => undefined);
    },
  };
}
