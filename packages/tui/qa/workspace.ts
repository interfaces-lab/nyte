import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "@nyte-ai/schema";

export const FIXTURE_PROVIDER = "opencode";

export const FIXTURE_MODEL = "nyte-qa";

export const FIXTURE_CHILD_MODEL = "nyte-qa-child";

// The production rename plugin prefers this exact model before the session model.
export const FIXTURE_TITLE_MODEL = "gpt-5.6-luna";

export const FIXTURE_API_KEY = "nyte-qa-loopback-only";

/** The project plugin appends one line here each time a session runs its setup. */
export const PLUGIN_EVIDENCE = join("evidence", "plugin-setups");

export interface Workspace {
  readonly cwd: string;
  readonly home: string;
  /** Pass this directly to spawn. Never merge the user's environment into it. */
  readonly env: Record<string, string>;
  close(): Promise<void>;
}

/**
 * Nyte resolves ripgrep from PATH and otherwise downloads it from GitHub. QA blocks that
 * download, so a compatible host ripgrep is a stated prerequisite, not a silent one.
 */
function hostRipgrep(): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, "rg");

    if (!existsSync(candidate)) continue;
    const probe = Bun.spawnSync([candidate, "--version"], { stdout: "pipe", stderr: "ignore" });
    const major = /^ripgrep (\d+)\./u.exec(probe.success ? probe.stdout.toString() : "")?.[1];

    if (major !== undefined && Number(major) >= 12) return candidate;
  }

  throw new Error(
    "Terminal QA needs ripgrep 12 or later on PATH (brew install ripgrep, apt-get install ripgrep). Without it Nyte tries to download ripgrep, which QA blocks.",
  );
}

/** Only public on-disk configuration is seeded. The binary owns its database. */
export async function createWorkspace(options: {
  readonly baseUrl: string;
  /** Adds project plugins (a probe command and the question tool), so Nyte asks for trust. */
  readonly plugin?: boolean;
}): Promise<Workspace> {
  const endpoint = new URL(options.baseUrl);

  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") {
    throw new Error("The QA provider must use HTTP on 127.0.0.1");
  }

  const ripgrep = hostRipgrep();
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-terminal-qa-")));
  const cwd = join(root, "workspace");
  const home = join(root, "home");
  const nyteHome = join(home, ".nyte");
  const tools = join(root, "bin");

  try {
    for (const directory of [cwd, nyteHome, tools, join(root, "tmp"), join(cwd, "evidence")]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }

    const models = [FIXTURE_MODEL, FIXTURE_CHILD_MODEL, FIXTURE_TITLE_MODEL].map(
      (id) =>
        ({
          id,
          name:
            id === FIXTURE_MODEL
              ? "Nyte QA"
              : id === FIXTURE_CHILD_MODEL
                ? "Nyte QA child"
                : "Nyte QA title",
          provider: FIXTURE_PROVIDER,
          api: "openai-completions",
          baseUrl: endpoint.href.replace(/\/$/u, ""),
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 4096,
          compat: { supportsStore: false, supportsDeveloperRole: false },
        }) satisfies Model<"openai-completions">,
    );

    const files = {
      "auth.json": { [FIXTURE_PROVIDER]: { type: "api_key", key: FIXTURE_API_KEY } },
      // A fresh checkedAt is what stops a catalog fetch; only the rawCatalogs shape keeps it.
      "models-store.json": {
        rawCatalogs: { [FIXTURE_PROVIDER]: { models, checkedAt: Date.now() } },
      },
      "settings.json": {
        defaultProvider: FIXTURE_PROVIDER,
        defaultModel: FIXTURE_MODEL,
        defaultThinkingLevel: "off",
        transport: "sse",
        autoUpdate: false,
        theme: "dark",
        compaction: { enabled: false },
      },
    };

    for (const [name, value] of Object.entries(files)) {
      await writeFile(join(nyteHome, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    }

    if (options.plugin === true) {
      // Bundle the public question example's dependencies, but use the binary's plugin API.
      const built = await Bun.build({
        entrypoints: [fileURLToPath(import.meta.resolve("@nyte-ai/plugin/examples/question"))],
        outdir: join(cwd, ".nyte", "plugins", "question"),
        naming: "index.js",
        target: "bun",
        format: "esm",
        external: ["@nyte-ai/plugin"],
      });

      if (!built.success)
        throw new AggregateError(built.logs, "Could not build the QA question plugin");

      const plugin = join(cwd, ".nyte", "plugins", "qa-probe");
      await mkdir(plugin, { recursive: true });
      await writeFile(
        join(plugin, "index.js"),
        `import { appendFileSync } from "node:fs";
export default {
  id: "qa-probe",
  session(api) {
    appendFileSync(${JSON.stringify(join(cwd, PLUGIN_EVIDENCE))}, "setup\\n");
    api.commands.add("qa-probe", {
      description: "Show that the project plugin loaded",
      run: () => "QA plugin answered",
    });
  },
};
`,
      );
    }

    await copyFile(new URL("./fixtures/heartbeat.sh", import.meta.url), join(cwd, "heartbeat.sh"));
    await writeFile(join(cwd, "README.md"), "# Isolated terminal QA workspace\n");
    await symlink(ripgrep, join(tools, "rg"));

    // Never let automated clipboard or browser actions reach the user's desktop.
    for (const command of [
      "pbcopy",
      "pbpaste",
      "xclip",
      "xsel",
      "wl-copy",
      "wl-paste",
      "open",
      "xdg-open",
    ]) {
      await writeFile(
        join(tools, command),
        '#!/bin/sh\necho "Desktop integration is disabled in terminal QA" >&2\nexit 1\n',
        { mode: 0o700 },
      );
    }

    const env = {
      HOME: home,
      NYTE_HOME: nyteHome,
      NYTE_OFFLINE: "1",
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      TMPDIR: join(root, "tmp"),
      PATH: `${tools}:/usr/bin:/bin:/usr/sbin:/sbin`,
      BROWSER: "/usr/bin/false",
      EDITOR: "/usr/bin/false",
      VISUAL: "/usr/bin/false",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      SHELL: "/bin/bash",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_US.UTF-8",
      // Reject accidental remote fetches at the loopback server, not a real upstream proxy.
      HTTP_PROXY: endpoint.origin,
      HTTPS_PROXY: endpoint.origin,
      ALL_PROXY: endpoint.origin,
      NO_PROXY: "127.0.0.1,localhost,::1",
      http_proxy: endpoint.origin,
      https_proxy: endpoint.origin,
      all_proxy: endpoint.origin,
      no_proxy: "127.0.0.1,localhost,::1",
    };

    return { cwd, home, env, close: () => rm(root, { recursive: true, force: true }) };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}
