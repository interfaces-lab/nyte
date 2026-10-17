import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { Value } from "typebox/value";
import { envFlagEnabled } from "./env.ts";
import { discoveredModelSchema } from "./model-catalog.ts";
import type { DiscoveredClaudeModel } from "./model-catalog.ts";
import { matchesRecord, parseRecord } from "./wire.ts";
import type { JsonRecord } from "./wire.ts";

const INSTALL_HINT =
  "Claude Code is not installed. Install it with `npm install -g @anthropic-ai/claude-code` " +
  "or set NYTE_CLAUDE_CODE_COMMAND to the executable.";

export const LOGIN_HINT =
  "Claude Code is installed but not logged in. Run `claude auth login` and try again.";

export interface ClaudeStatus {
  available: boolean;
  loggedIn: boolean;
  subscription: boolean;
  authMethod?: string;
  plan?: string;
  detail?: string;
  command?: string;
}

export function configuredCommand(env: Record<string, string | undefined>): string {
  return env.NYTE_CLAUDE_CODE_COMMAND || "claude";
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);

    return true;
  } catch {
    return false;
  }
}

async function resolveClaudeExecutable(
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const command = configuredCommand(env);

  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    const candidate = resolvePath(command);

    return (await executable(candidate)) ? candidate : undefined;
  }

  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .flatMap((suffix) => [suffix, suffix.toLowerCase()])
      : [""];

  for (const directory of (env.PATH || "").split(delimiter)) {
    if (!directory) continue;

    for (const suffix of extensions) {
      const candidate = join(
        directory,
        process.platform === "win32" && extname(command) ? command : command + suffix,
      );

      if (await executable(candidate)) return candidate;
    }
  }

  return undefined;
}

function withConfigDirectory(env: Record<string, string | undefined>): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) if (value !== undefined) output[key] = value;

  if (output.NYTE_CLAUDE_CODE_CONFIG_DIR)
    output.CLAUDE_CONFIG_DIR = output.NYTE_CLAUDE_CODE_CONFIG_DIR;

  return output;
}

async function captureProcess(
  command: string,
  args: string[],
  env: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  const child = spawnCommand(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => (stdout = (stdout + chunk).slice(-1_000_000)));
  child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-65_536)));

  const abort = () => killProcessTree(child);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  try {
    const code = await childExit(child);
    signal?.throwIfAborted();

    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function getClaudeStatus(
  envInput: Record<string, string | undefined> = process.env,
  signal?: AbortSignal,
): Promise<ClaudeStatus> {
  const env = withConfigDirectory(envInput);
  const command = await resolveClaudeExecutable(env);

  if (!command)
    return { available: false, loggedIn: false, subscription: false, detail: INSTALL_HINT };

  try {
    const result = await captureProcess(command, ["auth", "status"], env, signal);
    const payload = result.stdout.trim().startsWith("{") ? parseRecord(result.stdout) : {};
    const loggedIn = payload.loggedIn === true;

    const plan =
      typeof payload.subscriptionType === "string" ? payload.subscriptionType : undefined;

    return {
      available: true,
      loggedIn,
      subscription: loggedIn && !!plan,
      command,
      authMethod: typeof payload.authMethod === "string" ? payload.authMethod : undefined,
      plan,
      detail: loggedIn ? undefined : LOGIN_HINT,
    };
  } catch (error) {
    if (signal?.aborted) throw error;

    return { available: true, loggedIn: false, subscription: false, command, detail: LOGIN_HINT };
  }
}

const READY_STATUS_TTL_MS = 60_000;

const readyStatusCache = new Map<string, { command: string; expires: number }>();

export async function readyClaudeCommand(
  envInput: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<string> {
  const env = withConfigDirectory(envInput);
  const key = JSON.stringify([configuredCommand(env), env.PATH, env.HOME, env.CLAUDE_CONFIG_DIR]);
  const cached = readyStatusCache.get(key);

  if (cached && cached.expires > Date.now()) return cached.command;

  const status = await getClaudeStatus(env, signal);

  if (!status.available || !status.command) throw new Error(INSTALL_HINT);

  if (!status.loggedIn) {
    readyStatusCache.delete(key);
    throw new Error(LOGIN_HINT);
  }

  readyStatusCache.set(key, { command: status.command, expires: Date.now() + READY_STATUS_TTL_MS });

  return status.command;
}

export async function discoverClaudeModels(
  envInput: Record<string, string | undefined> = process.env,
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<DiscoveredClaudeModel[]> {
  signal?.throwIfAborted();
  const env = processEnvironment(envInput, {});
  const command = await resolveClaudeExecutable(env);

  if (!command) throw new Error(INSTALL_HINT);

  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "default",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
  ];

  const child = spawnCommand(command, args, {
    cwd: process.cwd(),
    env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-65_536)));

  const abort = () => killProcessTree(child);
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    killProcessTree(child);
  }, timeoutMs);

  const requestId = `nyte-models-${Date.now()}`;
  child.stdin?.write(
    `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } })}\n`,
  );
  child.stdin?.end(
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "model-catalog-probe" }] },
      shouldQuery: false,
    })}\n`,
  );

  let models: DiscoveredClaudeModel[] | undefined;

  try {
    if (child.stdout === null) throw new Error("Claude Code stdout is unavailable");
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });

    for await (const line of reader) {
      if (!line.trim()) continue;
      let event: JsonRecord;

      try {
        event = parseRecord(line);
      } catch {
        continue;
      }

      if (event.type !== "control_response") continue;
      const envelope = event.response;

      if (!matchesRecord(envelope)) continue;

      if (envelope.request_id !== requestId || envelope.subtype !== "success") continue;
      const response = envelope.response;

      if (matchesRecord(response) && Array.isArray(response.models))
        models = response.models.filter((model) => Value.Check(discoveredModelSchema, model));
    }

    const exitCode = await childExit(child);
    signal?.throwIfAborted();

    if (timedOut) throw new Error("Claude Code model discovery timed out");

    if (exitCode !== 0)
      throw new Error(
        `Claude Code model discovery failed${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`,
      );

    if (!models?.length) throw new Error("Claude Code returned no selectable models");

    return models;
  } catch (error) {
    if (timedOut) throw new Error("Claude Code model discovery timed out", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);

    if (child.exitCode === null) killProcessTree(child);
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}

export function spawnCommand(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
): ChildProcess {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command)) {
    const comspec = options?.env?.COMSPEC || process.env.COMSPEC || "cmd.exe";

    return spawn(
      comspec,
      ["/d", "/s", "/c", [quote(command), ...args.map(quote)].join(" ")],
      options,
    );
  }

  return spawn(command, args, options);
}

export function childExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) resolve(code);
      else reject(new Error(`Claude Code exited from signal ${signal ?? "unknown"}`));
    });
  });
}

export function killProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.unref();

    return;
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

function conflictingEnvironment(env: Record<string, string>): string[] {
  const conflicts = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_FOUNDRY_API_KEY",
  ].filter((key) => !!env[key]);

  for (const key of [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ]) {
    if (envFlagEnabled(env[key])) conflicts.push(key);
  }

  return conflicts;
}

export function processEnvironment(
  input: Record<string, string | undefined> | undefined,
  extraBody: JsonRecord,
): Record<string, string> {
  const env = withConfigDirectory({ ...process.env, ...input });
  const conflicts = conflictingEnvironment(env);

  if (conflicts.length) {
    throw new Error(
      `Claude Code subscription provider refuses conflicting auth/backend overrides: ${conflicts.join(", ")}`,
    );
  }

  delete env.CLAUDE_CODE_EXTRA_BODY;
  Object.assign(env, {
    ENABLE_TOOL_SEARCH: "false",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_MAX_RETRIES: "0",
    DISABLE_AUTO_COMPACT: "1",
    DISABLE_COMPACT: "1",
    CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  });

  if (typeof extraBody.max_tokens === "number")
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(extraBody.max_tokens);

  return env;
}
