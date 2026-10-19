import { watch } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { CliRenderEvents } from "@opentui/core";
import solidPlugin from "@opentui/solid/bun-plugin";
import { createRunnableDevEnvironment, createServer, isRunnableDevEnvironment } from "vite";
import type { Plugin, RunnableDevEnvironment } from "vite";
import { holdTypeahead } from "../src/app/typeahead.ts";
import type { AppOptions, MountedApp, mountApp, resumeOptions } from "../src/app/mount.tsx";

const TUI = fileURLToPath(new URL("..", import.meta.url));

const PACKAGES = resolve(TUI, "..");

const REPO = resolve(PACKAGES, "..");

const MOUNT = join(TUI, "src", "app", "mount.tsx");

const DEV = join(TUI, "dev");

const PROCESS_ENTRIES = [join(TUI, "src", "index.ts"), join(TUI, "src", "host-worker.ts")];

const QUIET_MS = 100;

const SETTLE_MS = 1_000;

const BUSY_RETRY_MS = 500;

const FIRST_FRAME_MS = 1_000;

const DURABLE = [
  "@opentui/core",
  "@opentui/solid",
  "@opentui/keymap",
  "@opentui/keymap/opentui",
  "@opentui/keymap/addons",
  "@opentui/keymap/addons/opentui",
  "@opentui/keymap/extras",
  "solid-js",
  "solid-js/store",
  "@nyte-ai/core",
  "@nyte-ai/sdk",
  "@nyte-ai/sdk/client",
  "@nyte-ai/schema",
  "@nyte-ai/schema/serial",
  "@nyte-ai/service",
  "@nyte-ai/connect",
  "@nyte-ai/connect/host",
  "typebox",
  "typebox/compile",
  "typebox/value",
];

interface MountModule {
  readonly mountApp: typeof mountApp;
  readonly resumeOptions: typeof resumeOptions;
}

interface Generation {
  readonly module: MountModule;
  readonly app: MountedApp;
}

export async function reloadingMount(options: AppOptions): Promise<MountedApp> {
  const vite = await createServer({
    root: REPO,
    configFile: false,
    envFile: false,
    appType: "custom",
    clearScreen: false,
    logLevel: "silent",
    server: { middlewareMode: true, ws: false, watch: null, hmr: false },
    plugins: [solidTransform()],
    environments: {
      nyte: {
        consumer: "server",
        resolve: {
          conditions: ["bun", "node", "module", "development"],
          externalConditions: ["bun", "node"],
          external: DURABLE,
        },
        optimizeDeps: { noDiscovery: true, include: [] },
        dev: {
          createEnvironment: (name, config) =>
            createRunnableDevEnvironment(name, config, { runnerOptions: { hmr: false } }),
        },
      },
    },
  });

  const environment = vite.environments["nyte"];

  if (environment === undefined || !isRunnableDevEnvironment(environment)) {
    await vite.close();

    throw new Error("Vite did not create a runnable environment for the TUI.");
  }

  const first = await load(environment);
  let current: Generation = { module: first, app: await first.mountApp(options) };
  const closing = Promise.withResolvers<number>();

  const adopt = (generation: Generation): void => {
    current = generation;
    void generation.app.closing.then((status) => {
      if (current === generation) closing.resolve(status);
    });
  };

  adopt(current);
  let outside: Promise<ReadonlySet<string>> | null = null;

  const inform = (tone: "info" | "ok" | "warning" | "error", text: string): void =>
    current.app.store.dispatch({ kind: "inform", tone, text });

  const swap = async (files: readonly string[]): Promise<void> => {
    const ui = files.filter((file) => environment.moduleGraph.getModulesByFile(file) !== undefined);
    const rest = files.filter((file) => !ui.includes(file));
    const known = rest.length === 0 ? new Set<string>() : await (outside ??= processFiles());
    const elsewhere = rest.filter((file) => known.has(file) || file.startsWith(DEV));

    if (elsewhere.length > 0)
      inform(
        "warning",
        `${elsewhere.map((file) => relative(REPO, file)).join(", ")} changed outside the UI · restart nyte to apply`,
      );

    if (ui.length === 0) return;
    const busy = current.app.busy();

    if (busy !== null) {
      inform("info", `Reloading the UI after ${busy} finishes`);
      setTimeout(() => queue(ui), BUSY_RETRY_MS).unref();

      return;
    }

    const started = performance.now();

    for (const file of ui)
      for (const module of environment.moduleGraph.getModulesByFile(file) ?? [])
        environment.moduleGraph.invalidateModule(module);

    environment.runner.clearCache();

    const loaded = await load(environment).then(
      (module) => ({ module, failure: null }),
      (cause: unknown) => ({ module: null, failure: failureText(cause) }),
    );

    if (loaded.module === null) {
      inform("error", `UI reload failed: ${loaded.failure}`);

      return;
    }

    const next = loaded.module;
    const previous = current;
    const carry = previous.app.carry();
    await previous.app.close();

    const mounted = await next
      .mountApp(next.resumeOptions(options, carry, holdTypeahead(options.renderer)))
      .then(
        async (app) => ({ app, failure: await renderFailure(options, app) }),
        (cause: unknown) => ({ app: null, failure: failureText(cause) }),
      );

    if (mounted.app !== null && mounted.failure === null) {
      adopt({ module: next, app: mounted.app });
      inform("ok", `UI reloaded · ${String(Math.round(performance.now() - started))} ms`);

      return;
    }

    await mounted.app?.close();

    const restored = await previous.module.mountApp(
      previous.module.resumeOptions(options, carry, holdTypeahead(options.renderer)),
    );

    adopt({ module: previous.module, app: restored });
    inform("error", `UI reload failed: ${mounted.failure}`);
  };

  let reloading = Promise.resolve();
  const pending = new Set<string>();
  let quiet: ReturnType<typeof setTimeout> | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (quiet !== null) clearTimeout(quiet);

    if (settle !== null) clearTimeout(settle);
    quiet = null;
    settle = null;
    const files = [...pending];
    pending.clear();
    reloading = reloading.then(() =>
      swap(files).catch((cause: unknown) => {
        inform("error", `UI reload failed: ${failureText(cause)}`);
      }),
    );
  };

  const queue = (files: readonly string[]): void => {
    for (const file of files) pending.add(file);

    if (quiet !== null) clearTimeout(quiet);
    quiet = setTimeout(flush, QUIET_MS);
    settle ??= setTimeout(flush, SETTLE_MS);
  };

  const watcher = watch(PACKAGES, { recursive: true, persistent: false }, (_event, name) => {
    if (name === null) return;
    const file = join(PACKAGES, name);

    if (/\.tsx?$/u.test(file) && !/[/\\](node_modules|dist)[/\\]|[/\\]\.spike-/u.test(file))
      queue([file]);
  });

  watcher.on("error", (cause) =>
    inform("error", `Watching for UI changes stopped: ${cause.message}`),
  );

  let closed: Promise<void> | null = null;

  return {
    get store() {
      return current.app.store;
    },
    closing: closing.promise,
    report: (origin, error) => current.app.report(origin, error),
    startupError: () => current.app.startupError(),
    carry: () => current.app.carry(),
    busy: () => current.app.busy(),
    exit: () => current.app.exit(),
    close: () =>
      (closed ??= (async () => {
        watcher.close();

        if (quiet !== null) clearTimeout(quiet);

        if (settle !== null) clearTimeout(settle);
        await reloading;
        await current.app.close();
        await vite.close();
      })()),
  };
}

async function load(environment: RunnableDevEnvironment): Promise<MountModule> {
  const loaded = await environment.runner.import<Partial<MountModule>>(MOUNT);

  if (loaded.mountApp === undefined || loaded.resumeOptions === undefined)
    throw new Error(`${relative(REPO, MOUNT)} does not export mountApp and resumeOptions.`);

  return { mountApp: loaded.mountApp, resumeOptions: loaded.resumeOptions };
}

async function renderFailure(options: AppOptions, app: MountedApp): Promise<string | null> {
  await new Promise<void>((done) => {
    const timer = setTimeout(done, FIRST_FRAME_MS);
    options.renderer.once(CliRenderEvents.FRAME, () => {
      clearTimeout(timer);
      done();
    });
    options.renderer.requestRender();
  });

  return app.exit().crashes.find((crash) => crash.origin === "render")?.message ?? null;
}

async function processFiles(): Promise<ReadonlySet<string>> {
  const built = await Bun.build({
    entrypoints: PROCESS_ENTRIES,
    root: PACKAGES,
    target: "bun",
    plugins: [solidPlugin],
    metafile: true,
    throw: false,
    external: ["@opentui/core-*"],
  });

  return new Set(
    Object.keys(built.metafile?.inputs ?? {})
      .filter((input) => !input.includes("node_modules"))
      .map((input) => resolve(process.cwd(), input)),
  );
}

function solidTransform(): Plugin {
  return {
    name: "nyte-solid",
    enforce: "pre",
    async transform(code, id) {
      const [file = id] = id.split("?");

      if (!file.endsWith(".tsx") || file.includes("/node_modules/")) return null;

      const result = await transformAsync(code, {
        filename: file,
        cwd: TUI,
        configFile: false,
        babelrc: false,
        presets: [
          ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
          "@babel/preset-typescript",
        ],
      });

      return result?.code === undefined || result.code === null ? null : result.code;
    },
  };
}

function failureText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
