import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ExecutionEnv, PluginApi } from "@nyte-ai/core";
import { SdkError } from "@nyte-ai/schema";
import type { Command, Plugin } from "@nyte-ai/plugin/core";

const SHELL_TIMEOUT_MS = 10_000;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const SHELL_SAFE = /^[\w./+-]+$/u;

const cdCommand: Command<"core"> = {
  name: "cd",
  title: "Change directory",
  description: "Change this chat's working directory with your shell's cd",
  takesText: true,
  async complete(prefix, { api }) {
    const folders = await directorySuggestions({
      path: prefix,
      cwd: attachedEnv(api)?.cwd ?? homedir(),
    });

    return folders.map((folder) => ({ value: folder.value, label: folder.label }));
  },
  async run(text, { api, signal }) {
    if (CONTROL_CHARACTERS.test(text)) throw new Error("Put /cd and its path on one line.");

    if (process.platform === "win32") {
      throw new Error("/cd runs your shell's cd, and Windows hosts don't have one yet.");
    }
    const env = attachedEnv(api);
    const present = env !== null && (await stat(env.cwd).catch(() => null)) !== null;
    const path = present ? await shellCd(env, text, signal) : fullPath(text);

    if (path === env?.cwd) return `Already in ${path}`;
    const seen = await api.host.workspaces.inspect({ kind: "local", path });

    const added = await api.host.workspaces.add(seen.target, {
      expect: { identity: seen.identity },
    });

    if (added.kind === "stale") throw new Error(`${path} changed while it was opened. Try again.`);

    if (added.kind === "unavailable") {
      throw new Error(`Can't open ${path}. Check that Nyte has access to it.`);
    }

    return { workspace: added.workspace, output: `Working directory: ${path}` };
  },
};

function attachedEnv(api: PluginApi<"core">): ExecutionEnv | null {
  try {
    return api.env;
  } catch (error) {
    if (error instanceof SdkError && error.code === "unavailable") return null;
    throw error;
  }
}

function fullPath(text: string): string {
  const path = text.trim();

  if (path === "~" || path.startsWith("~/")) return resolve(homedir(), path.slice(2));

  if (isAbsolute(path)) return resolve(path);

  throw new Error(
    "This chat's folder is gone, so /cd needs a full path, such as ~/project or /Users/you/project.",
  );
}

async function shellCd(env: ExecutionEnv, text: string, signal: AbortSignal): Promise<string> {
  const marker = `nyte-cd-${crypto.randomUUID()}:`;
  const timeout = AbortSignal.timeout(SHELL_TIMEOUT_MS);

  await using job = await env.exec(
    [
      "/bin/sh",
      "-c",
      'exec "${SHELL:-/bin/sh}" -ic "$1" </dev/null',
      "nyte-cd",
      `cd ${text} && printf '\\n%s' ${marker} && pwd -P`,
    ],
    { signal: AbortSignal.any([signal, timeout]), stdio: "protocol" },
  );

  const decoder = new TextDecoder();
  let stdout = "";
  let stderr = "";
  let code: number | null = null;

  for await (const frame of job.output()) {
    if (frame.kind === "exit") {
      code = frame.code;

      break;
    }

    if (frame.kind !== "bytes") continue;

    if (frame.stream === "stderr") stderr += decoder.decode(frame.data, { stream: true });
    else stdout += decoder.decode(frame.data, { stream: true });
  }

  const path = stdout
    .split(/\r?\n/u)
    .findLast((line) => line.startsWith(marker))
    ?.slice(marker.length);

  if (code === 0 && path !== undefined && path !== "") return path;

  if (timeout.aborted) throw new Error("Your shell didn't finish cd within 10 s.");

  throw new Error(
    stderr
      .split(/\r?\n/u)
      .findLast((line) => line.trim() !== "")
      ?.trim() ?? `cd ${text} failed.`,
  );
}

async function directorySuggestions(options: {
  readonly path: string;
  readonly cwd: string;
}): Promise<readonly { readonly value: string; readonly label: string }[]> {
  if (CONTROL_CHARACTERS.test(options.path)) return [];
  const path = /^(?:~|(?:\.\.\/)*\.\.)$/u.test(options.path) ? `${options.path}/` : options.path;
  const split = path.lastIndexOf("/") + 1;
  const parent = path.slice(0, split);
  const prefix = path.slice(split).toLowerCase();

  const directory = resolve(
    options.cwd,
    parent.startsWith("~/") ? `${homedir()}/${parent.slice(2)}` : parent,
  );

  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  const matches = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.name.toLowerCase().startsWith(prefix)) return undefined;

      if (entry.name.startsWith(".") && !prefix.startsWith(".")) return undefined;

      if (CONTROL_CHARACTERS.test(entry.name)) return undefined;

      if (!entry.isDirectory()) {
        if (!entry.isSymbolicLink()) return undefined;
        const target = await stat(resolve(directory, entry.name)).catch(() => undefined);

        if (!target?.isDirectory()) return undefined;
      }

      return { value: `${parent}${shellWord(entry.name)}/`, label: `${parent}${entry.name}/` };
    }),
  );

  return matches
    .filter((match) => match !== undefined)
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

function shellWord(name: string): string {
  return SHELL_SAFE.test(name) ? name : `'${name.replaceAll("'", String.raw`'\''`)}'`;
}

export default {
  id: "cd",
  contribute: { commands: [cdCommand] },
} satisfies Plugin;
