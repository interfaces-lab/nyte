import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { asId } from "@nyte-ai/schema";
import type {
  FileDocument,
  FileEntryView,
  FileVersion,
  JobEnd,
  OutputFrame,
  ScanFrame,
  SearchFrame,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { SdkError, closable, objectId } from "@nyte-ai/core";
import type { ExecutionEnv, FileBatch, FilesApi, Job } from "@nyte-ai/core";
import type { SandboxHandle } from "@nyte-ai/host/providers";
import { Sandbox } from "@vercel/sandbox";

const TEXT_LIMIT = 1024 * 1024;

const PAGE = 500;

const FIND_DEFAULT = 20;

const FIND_CAP = 50;

const SEARCH_DEFAULT = 200;

const STAT = `if [ -L "$1" ]; then printf 'symlink %s %s' "$(stat -c %s "$1")" "$(readlink "$1")"; elif [ -d "$1" ]; then printf 'directory 0'; elif [ -f "$1" ]; then printf 'file %s' "$(stat -c %s "$1")"; fi`;

const SCAN = `find "$1" -mindepth 1 -name .git -prune -o -printf '%y\\t%s\\t%P\\n'`;

const decoder = new TextDecoder("utf-8", { fatal: true });

const encoder = new TextEncoder();

/** Boots or joins the Vercel Sandbox a `{ kind: "sandbox", locator: { name } }` target names, through `@vercel/sandbox`'s `Sandbox.getOrCreate({ name })` (a target without a string `name` throws `SdkError("invalid")`; a failed boot throws `SdkError("unavailable")` with the SDK's message), and answers its handle: identity the target's content hash (core's `objectId`, what `sandboxProvider`'s default `inspect` answers), `cwd` the sandbox's `cwd`, `files` over the sandbox's file and command calls (paths relative to `cwd`, §41j; an absolute path outside it throws `SdkError("invalid")`, so the sandbox serves no ancestor context files, §37g; versions are SHA-256 of the bytes; `scan` prunes `.git` and applies no ignore rules; `search` is a fixed-string `grep`; `watch` sees no changes; `format` answers `unavailable`; `batch` and `upload` are core's), `exec` over `runCommand` detached as a pipe job (stdin `unavailable`, a pty `unavailable`, stop SIGTERM), `destroy` over `delete()`, and no `git` or `snapshots` seam, so its workspace answers `git` `unsupported` (§42c). */
export async function vercelSandbox(target: WorkspaceTarget): Promise<SandboxHandle> {
  const name = nameOf(target);

  const sandbox = await Sandbox.getOrCreate({ name }).catch((error: unknown) => {
    throw new SdkError(
      "unavailable",
      `The Vercel Sandbox ${name} did not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const cwd = sandbox.cwd;

  return {
    identity: asId<"environment-identity">(await objectId(target)),
    cwd,
    files: sandboxFiles(sandbox, cwd),
    exec: (command, options) => startJob(sandbox, cwd, command, options),
    destroy: () => sandbox.delete(),
  };
}

function nameOf(target: WorkspaceTarget): string {
  const locator = "locator" in target ? target.locator : null;

  if (
    typeof locator === "object" &&
    locator !== null &&
    !Array.isArray(locator) &&
    "name" in locator &&
    typeof locator.name === "string" &&
    locator.name !== ""
  )
    return locator.name;

  throw new SdkError(
    "invalid",
    "A sandbox workspace names its Vercel Sandbox: { locator: { name } }.",
  );
}

/** Returns the files of a Vercel Sandbox under `cwd`, as `vercelSandbox` describes them. */
function sandboxFiles(sandbox: Sandbox, cwd: string): FilesApi {
  const at = (path: string): string => {
    const absolute = posix.resolve(cwd, path);

    if (absolute !== cwd && !absolute.startsWith(`${cwd}/`))
      throw new SdkError("invalid", `${path} is outside the sandbox workspace.`);

    return absolute;
  };

  const sh = async (
    script: string,
    ...args: string[]
  ): Promise<{ readonly code: number; readonly out: string }> => {
    const done = await sandbox.runCommand({ cmd: "sh", args: ["-c", script, "sh", ...args], cwd });

    return { code: done.exitCode, out: await done.stdout() };
  };

  const contents = async (path: string): Promise<Uint8Array | null> => {
    const buffer = await sandbox.readFileToBuffer({ path: at(path) });

    return buffer === null ? null : new Uint8Array(buffer);
  };

  const current = async (path: string): Promise<FileVersion | null> => {
    const bytes = await contents(path);

    return bytes === null ? null : versionOf(bytes);
  };

  const refuse = async (): Promise<never> => {
    throw new SdkError("unavailable", "Core supplies this for a sandbox's files.");
  };

  const plan: FileBatch = { put: () => plan, remove: () => plan, apply: refuse };

  const entries = async (directory: string): Promise<readonly FileEntryView[]> => {
    const root = at(directory);
    const prefix = posix.relative(cwd, root);
    const { out } = await sh(SCAN, root);

    return out.split("\n").flatMap((line): readonly FileEntryView[] => {
      const [type, size, path] = line.split("\t");

      const kind =
        type === "f" ? "file" : type === "d" ? "directory" : type === "l" ? "symlink" : null;

      if (kind === null || path === undefined || path === "") return [];

      return [
        {
          path: prefix === "" ? path : posix.join(prefix, path),
          kind,
          size: kind === "file" ? Number(size) : null,
          version: null,
        },
      ];
    });
  };

  return {
    async read(path): Promise<FileDocument> {
      const bytes = await contents(path);

      if (bytes === null) return { kind: "missing", path };
      const version = versionOf(bytes);

      if (bytes.byteLength > TEXT_LIMIT)
        return { kind: "large", path, size: bytes.byteLength, version };

      try {
        return { kind: "text", path, contents: decoder.decode(bytes), version };
      } catch {
        return { kind: "binary", path, size: bytes.byteLength, version };
      }
    },
    async bytes(path) {
      const bytes = await contents(path);

      if (bytes === null) throw new SdkError("unknown", `No file is at ${path}.`);

      return {
        size: bytes.byteLength,
        mime: null,
        version: versionOf(bytes),
        async *chunks() {
          yield bytes;
        },
        close: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      };
    },
    async stat(path) {
      const { out } = await sh(STAT, at(path));
      const [kind, size, ...rest] = out.split(" ");

      if (kind === "file") {
        const version = await current(path);

        return version === null ? null : { kind, size: Number(size), version };
      }

      if (kind === "directory")
        return { kind, size: 0, version: asId<"file-version">("directory") };

      if (kind === "symlink") {
        const target = rest.join(" ");

        return { kind, size: Number(size), version: versionOf(encoder.encode(target)), target };
      }

      return null;
    },
    async write(path, data, options) {
      const absolute = at(path);
      const existing = await current(path);

      if (
        options?.expect === "absent"
          ? existing !== null
          : options?.expect !== undefined && options.expect !== existing
      )
        return { kind: "stale", current: existing };

      if ((await sh('test -d "$(dirname "$1")"', absolute)).code !== 0) {
        if (options?.parents !== true) return { kind: "missing-parent" };
        await sh('mkdir -p "$(dirname "$1")"', absolute);
      }

      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      await sandbox.writeFiles([{ path: absolute, content: bytes }]);

      return { kind: "saved", version: versionOf(bytes) };
    },
    async remove(path, options) {
      const existing = await current(path);

      if (existing === null || (options?.expect !== undefined && options.expect !== existing))
        return { kind: "stale", current: existing };
      await sh('rm -f "$1"', at(path));

      return { kind: "saved", version: existing };
    },
    batch: () => plan,
    format: async () => ({
      kind: "unavailable",
      reason: "A Vercel Sandbox runs no formatter here.",
    }),
    async *scan(input): AsyncGenerator<ScanFrame> {
      const found = await entries(input?.directory ?? ".");

      for (let offset = 0; offset < found.length; offset += PAGE)
        yield { kind: "entries", entries: found.slice(offset, offset + PAGE) };

      yield { kind: "complete" };
    },
    async find(input) {
      const query = input.query.toLowerCase();
      const limit = Math.min(input.limit ?? FIND_DEFAULT, FIND_CAP);

      return (await entries("."))
        .filter((entry) => posix.basename(entry.path).toLowerCase().includes(query))
        .slice(0, limit);
    },
    async *search(input): AsyncGenerator<SearchFrame> {
      const limit = input.limit ?? SEARCH_DEFAULT;
      const { out } = await sh('grep -rnIF --exclude-dir=.git -e "$2" "$1"', cwd, input.query);
      let count = 0;

      for (const line of out.split("\n")) {
        const match = /^(.*?):(\d+):(.*)$/.exec(line);

        if (match === null) continue;

        if (count === limit) {
          yield { kind: "truncated", limit };

          return;
        }

        const [, path = "", number = "0", text = ""] = match;
        count += 1;
        yield {
          kind: "match",
          path: posix.relative(cwd, path),
          line: Number(number),
          column: text.indexOf(input.query) + 1,
          text,
        };
      }

      yield { kind: "complete" };
    },
    watch: () =>
      closable(() => ({
        pull: () => new Promise<never>(() => undefined),
        close: () => undefined,
      })),
    upload: refuse,
  };
}

/** Starts a process in the sandbox as a detached pipe job: a string runs under `sh -lc`, an argv as given, an empty argv the login shell. */
async function startJob(
  sandbox: Sandbox,
  cwd: string,
  command: string | readonly string[],
  options: Parameters<ExecutionEnv["exec"]>[1],
): Promise<Job> {
  if (options?.pty !== undefined)
    throw new SdkError("unavailable", "A Vercel Sandbox job runs without a terminal.");

  const [program, ...args] =
    typeof command === "string"
      ? ["sh", "-lc", command]
      : command.length === 0
        ? ["sh", "-l"]
        : command;

  const running = await sandbox.runCommand({
    cmd: program ?? "sh",
    args,
    cwd: options?.cwd === undefined ? cwd : posix.resolve(cwd, options.cwd),
    env: options?.env === undefined ? undefined : { ...options.env },
    detached: true,
  });

  let stopping = false;

  const ended: Promise<JobEnd> = running.wait().then(
    (done) => ({ kind: "exited", code: done.exitCode, reason: stopping ? "terminated" : "exited" }),
    () => ({ kind: "lost" }),
  );

  const stop = async (): Promise<void> => {
    stopping = true;
    await running.kill("SIGTERM").catch(() => undefined);
  };

  options?.signal?.addEventListener("abort", () => void stop(), { once: true });

  return {
    id: asId<"job">(randomUUID()),
    key: null,
    async write() {
      throw new SdkError("unavailable", "A Vercel Sandbox job takes no input.");
    },
    async *output(): AsyncGenerator<OutputFrame> {
      for await (const line of running.logs())
        yield { kind: "bytes", data: encoder.encode(line.data) };
      const end = await ended;

      yield { kind: "exit", code: end.kind === "exited" ? end.code : null };
    },
    resize: async () => ({ kind: "not-pty" }),
    idle: async () => false,
    async stop() {
      await stop();

      return { kind: "settled", outcome: await ended };
    },
    settled: () => ended,
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };
}

function versionOf(bytes: Uint8Array): FileVersion {
  return asId<"file-version">(createHash("sha256").update(bytes).digest("hex"));
}
