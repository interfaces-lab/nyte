import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "@nyte-ai/schema";

export const FIXTURE_PROVIDER = "opencode";
export const FIXTURE_MODEL = "nyte-qa";
export const FIXTURE_CHILD_MODEL = "nyte-qa-child";
// The production rename plugin prefers this exact model before the session model.
export const FIXTURE_TITLE_MODEL = "gpt-5.6-luna";
export const FIXTURE_API_KEY = "nyte-qa-loopback-only";

export interface Workspace {
  readonly root: string;
  readonly cwd: string;
  readonly home: string;
  readonly nyteHome: string;
  /** Pass this directly to spawn. Never merge the user's environment into it. */
  readonly env: Record<string, string>;
  readonly model: string;
  readonly childModel: string;
  readonly image: string;
  readonly heartbeatCommand: string;
  releaseTool(): Promise<void>;
  close(): Promise<void>;
}

/** Only public on-disk configuration is seeded. The binary owns its database. */
export async function createWorkspace(options: {
  readonly baseUrl: string;
  readonly trusted?: boolean;
  readonly question?: boolean;
  readonly reasoning?: Model<"openai-completions">["reasoning"];
}): Promise<Workspace> {
  const endpoint = new URL(options.baseUrl);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") {
    throw new Error("The QA provider must use HTTP on 127.0.0.1");
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-terminal-qa-")));
  const cwd = join(root, "workspace");
  const home = join(root, "home");
  const nyteHome = join(home, ".nyte");
  try {
    for (const directory of [cwd, nyteHome, join(root, "tmp"), join(cwd, "evidence")]) {
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
          reasoning: options.reasoning ?? false,
          input: ["text", "image"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 4096,
          compat: { supportsStore: false, supportsDeveloperRole: false },
        }) satisfies Model<"openai-completions">,
    );
    const files = {
      "auth.json": { [FIXTURE_PROVIDER]: { type: "api_key", key: FIXTURE_API_KEY } },
      // Freshness prevents background catalog discovery. NYTE_OFFLINE only disables updates.
      "models-store.json": { [FIXTURE_PROVIDER]: { models, checkedAt: Date.now() } },
      "settings.json": {
        defaultProvider: FIXTURE_PROVIDER,
        defaultModel: FIXTURE_MODEL,
        defaultThinkingLevel: "off",
        transport: "sse",
        autoUpdate: false,
        theme: "dark",
        compaction: { enabled: false },
      },
      "trust.json": options.trusted === false ? {} : { [cwd]: true },
    };
    for (const [name, value] of Object.entries(files)) {
      await writeFile(join(nyteHome, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    }
    if (options.question === true) {
      const plugins = join(cwd, ".nyte", "plugins");
      // Bundle the public example's dependencies, but use the binary's plugin API.
      const built = await Bun.build({
        entrypoints: [fileURLToPath(import.meta.resolve("@nyte-ai/plugin/examples/question"))],
        outdir: plugins,
        naming: "question.js",
        target: "bun",
        format: "esm",
        external: ["@nyte-ai/plugin"],
      });
      if (!built.success)
        throw new AggregateError(built.logs, "Could not build QA question plugin");
    }
    await copyFile(new URL("./fixtures/heartbeat.sh", import.meta.url), join(cwd, "heartbeat.sh"));
    const image = join(cwd, "pixel.png");
    await writeFile(
      image,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(join(cwd, "README.md"), "# Isolated terminal QA workspace\n");
    // A one-line edit target for the diff card; `qty` → `quantity` is the intra-line change.
    await writeFile(
      join(cwd, "total.ts"),
      "export function total(price: number, qty: number) {\n  return price * qty;\n}\n",
    );
    const tools = join(root, "bin");
    await mkdir(tools, { mode: 0o700 });
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
    const env: Record<string, string> = {
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
    return {
      root,
      cwd,
      home,
      nyteHome,
      env,
      model: FIXTURE_MODEL,
      childModel: FIXTURE_CHILD_MODEL,
      image,
      heartbeatCommand: "/bin/bash ./heartbeat.sh",
      releaseTool: () => writeFile(join(cwd, "evidence", "release"), "release\n"),
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}
