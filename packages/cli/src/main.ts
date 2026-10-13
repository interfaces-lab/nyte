import { resolve } from "node:path";
import process from "node:process";
import { buffer } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { sqliteStore } from "@nyte-ai/host";
import canvasPlugin from "@nyte-ai/plugin/canvas";
import { isPart, text } from "@nyte-ai/plugin/core";
import { dev, sdk } from "@nyte-ai/sdk";
import type { Host, OpenHostOptions } from "@nyte-ai/sdk";
import { launch } from "./launcher.js";

/**
 * What `main` composes with and writes to. Every field defaults to this
 * process: its catalog, home, working directory, SIGINT/SIGTERM and stdio.
 * Tests pass a scripted catalog, a temporary home and folder, and a signal
 * that ends `serve`.
 */
export interface MainOptions {
  readonly models?: OpenHostOptions["models"];
  readonly home?: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly stdout?: (chunk: string) => void;
  readonly stderr?: (chunk: string) => void;
}

/**
 * Runs one `nyte` invocation and resolves its exit code. `serve` and a
 * `-p`/`--print` before any `--` run here over `sdk.open`; everything else
 * is the terminal client, the native binary `launch` spawns.
 */
export async function main(args: readonly string[], options: MainOptions = {}): Promise<number> {
  if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, "cli");
  if (args[0] === "serve") return serve(args.slice(1), options);
  const end = args.indexOf("--");
  const flags = end === -1 ? args : args.slice(0, end);

  if (flags.includes("-p") || flags.includes("--print")) return print(args, options);

  return launch([...args]);
}

/**
 * Sends one prompt to a new session on a host over the working directory and
 * prints the turn's text parts from `session.view()` once the receipt
 * settles; `--provider` with `--model` first becomes the host's default
 * model. The exit code is the run's end: 0 completed, 130 stopped, 1 failed
 * or never run, 2 for a usage error or an unknown model. An interrupt stops
 * the run durably and waits for it to settle.
 */
async function print(args: readonly string[], options: MainOptions): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      print: { type: "boolean", short: "p" },
      provider: { type: "string" },
      model: { type: "string" },
      store: { type: "string" },
    },
  });

  const out = options.stdout ?? ((chunk: string) => void process.stdout.write(chunk));
  const err = options.stderr ?? ((chunk: string) => void process.stderr.write(chunk));

  if ((values.provider === undefined) !== (values.model === undefined)) {
    err("Pass --provider and --model together.\n");

    return 2;
  }

  const prompt = (
    positionals.length > 0
      ? positionals.join(" ")
      : process.stdin.isTTY
        ? ""
        : (await buffer(process.stdin)).toString("utf8")
  ).trim();

  if (prompt === "") {
    err("Pass a prompt after --print, or on stdin.\n");

    return 2;
  }

  await using opened = await open(values.store, options);

  if (values.provider !== undefined && values.model !== undefined) {
    const set = await opened.host.models.setDefault({
      provider: values.provider,
      id: values.model,
    });

    if (set.kind === "unknown-model") {
      err(`Unknown model: ${values.provider}/${values.model}.\n`);

      return 2;
    }
  }

  const session = await opened.host.sessions.create({});

  const receipt = await session.send(prompt);
  const signal = options.signal ?? interruption();
  const stop = (): void => void receipt.stop().catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  const ended = await receipt.settled().finally(() => signal.removeEventListener("abort", stop));
  const view = await session.view();
  const turn = view.turns.find((entry) => entry.prompt === receipt.message);

  const answer = view.messages
    .flatMap((message) =>
      message.turn === turn?.id && isPart(message, text) ? [message.state.markdown] : [],
    )
    .join("\n\n");

  if (answer !== "") out(`${answer}\n`);

  switch (ended.kind) {
    case "completed":
      return 0;
    case "stopped":
      return 130;
    case "failed":
      err(`${ended.failure.message}\n`);

      return 1;
    default:
      err(`The prompt did not run: ${ended.kind}.\n`);

      return 1;
  }
}

/**
 * Serves a host over the working directory on HTTP until interrupted, with
 * the canvas plugin for the clients that draw canvases: `--port` (default 0,
 * any free port), `--token` (default a fresh one, printed to stderr) and
 * `--store`. Writes the listener's address to stdout once it is bound.
 */
async function serve(args: readonly string[], options: MainOptions): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    options: {
      port: { type: "string" },
      token: { type: "string" },
      store: { type: "string" },
    },
  });

  const out = options.stdout ?? ((chunk: string) => void process.stdout.write(chunk));
  const err = options.stderr ?? ((chunk: string) => void process.stderr.write(chunk));
  const port = Number(values.port ?? "0");

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    err("--port must be a port number.\n");

    return 2;
  }

  const token = values.token ?? crypto.randomUUID();
  const signal = options.signal ?? interruption();
  await using opened = await open(values.store, options, [canvasPlugin]);

  const listener = await opened.host.listen({
    transport: { kind: "http", port },
    auth: { kind: "token", token },
  });

  out(`${listener.address}\n`);

  if (values.token === undefined) err(`token ${token}\n`);

  if (!signal.aborted)
    await new Promise((done) => signal.addEventListener("abort", done, { once: true }));

  return 0;
}

/**
 * Opens a host on the working directory with the local environment, over the
 * sqlite file `path` names, else the host's own `<home>/.nyte/nyte.db`.
 * Disposing it closes the host, its listeners included, then a `path` store.
 */
async function open(
  path: string | undefined,
  options: MainOptions,
  plugins: OpenHostOptions["plugins"] = [],
): Promise<{ readonly host: Host; [Symbol.asyncDispose](): Promise<void> }> {
  const cwd = options.cwd ?? process.cwd();
  const store = path === undefined ? undefined : sqliteStore({ path: resolve(cwd, path) });

  let host: Host;

  try {
    host = await sdk.open({
      store,
      models: options.models,
      workspace: { kind: "local", path: cwd },
      home: options.home,
      plugins,
    });
  } catch (error) {
    await store?.close();

    throw error;
  }

  return {
    host,
    async [Symbol.asyncDispose]() {
      await host.close();
      await store?.close();
    },
  };
}

/** Returns a signal that aborts on the first SIGINT or SIGTERM, which then no longer ends the process. */
function interruption(): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  return controller.signal;
}
