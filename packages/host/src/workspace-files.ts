import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import type { OperationInput, OperationOutput, WorkspaceBlameLine } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const fileErrors = {
  not_file: "Path is not a workspace file",
  too_large: "File is too large to save in the workbench",
  changed: "File changed while opening it; retry the operation",
  drafts_too_large: "Search drafts exceed 2 MB",
};

export class WorkspaceFileError extends Error {
  readonly reason: keyof typeof fileErrors;

  constructor(reason: keyof typeof fileErrors) {
    super(fileErrors[reason]);
    this.name = "WorkspaceFileError";
    this.reason = reason;
  }
}

export type { WorkspaceFileDocument, WorkspaceFileSaveOutcome } from "@nyte-ai/protocol";

export const MAX_WORKSPACE_FILE_BYTES = 2_000_000;

const pendingFileWrites = new Map<string, Promise<OperationOutput<"workspace.save">>>();

function fileVersion(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function contains(directory: string, path: string): boolean {
  const inside = relative(directory, path);

  return inside !== "" && !isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`);
}

export async function resolveWorkspaceFile(workspacePath: string, path: string): Promise<string> {
  const workspace = await realpath(workspacePath);
  const file = await realpath(resolve(workspace, path));

  if (!contains(workspace, file) || !(await lstat(file)).isFile())
    throw new WorkspaceFileError("not_file");

  return file;
}

// O_NOFOLLOW protects the final component on POSIX. Node has no portable openat2
// or directory-relative open: identity and path rechecks narrow ancestor races,
// but are not a sandbox against hostile directory renames or hard links.
async function openWorkspaceFile(workspacePath: string, path: string, writable: boolean) {
  const workspace = await realpath(workspacePath);
  const file = await resolveWorkspaceFile(workspace, path);
  const before = await lstat(file);

  if (!before.isFile()) throw new WorkspaceFileError("not_file");

  const handle = await open(
    file,
    (writable ? constants.O_RDWR : constants.O_RDONLY) |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  );

  try {
    const opened = await handle.stat();

    if (!opened.isFile()) throw new WorkspaceFileError("not_file");
    const checked = await resolveWorkspaceFile(workspace, file);
    const after = await lstat(checked);

    if (
      checked !== file ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino
    )
      throw new WorkspaceFileError("changed");

    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readBounded(handle: FileHandle) {
  const size = (await handle.stat()).size;

  if (size > MAX_WORKSPACE_FILE_BYTES) return { kind: "too_large", size } as const;
  const buffer = Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1);
  let length = 0;

  while (length < buffer.length) {
    const result = await handle.read(buffer, length, buffer.length - length, length);

    if (result.bytesRead === 0) break;
    length += result.bytesRead;
  }

  if (length > MAX_WORKSPACE_FILE_BYTES) return { kind: "too_large", size: length } as const;

  return { kind: "bytes", contents: buffer.subarray(0, length) } as const;
}

export async function readWorkspaceFile(
  workspacePath: string,
  path: string,
): Promise<OperationOutput<"workspace.read">> {
  const handle = await openWorkspaceFile(workspacePath, path, false);

  try {
    const result = await readBounded(handle);

    if (result.kind === "too_large") return { ...result, path };
    const contents = result.contents;

    if (contents.includes(0)) return { kind: "binary", path, size: contents.length };
    let text: string;

    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      return { kind: "binary", path, size: contents.length };
    }

    return { kind: "text", path, contents: text, version: fileVersion(contents) };
  } finally {
    await handle.close();
  }
}

async function runFileCommand(input: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin?: string;
  readonly signal?: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );

    const child = execFile(
      input.executable,
      [...input.args],
      {
        cwd: input.cwd,
        encoding: "utf8",
        timeout: 10_000,
        killSignal: "SIGKILL",
        maxBuffer: 8_000_000,
        shell: false,
        signal: input.signal,
        env: {
          ...environment,
          ...input.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });

          return;
        }

        if (typeof error.code !== "number") {
          reject(error);

          return;
        }

        resolve({ code: error.code, stdout, stderr });
      },
    );

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.stdin);
  });
}

function commandMessage(
  result: { readonly stdout: string; readonly stderr: string },
  fallback: string,
): string {
  return (
    [...result.stderr.split("\n"), ...result.stdout.split("\n")]
      .map((line) => line.trim())
      .find((line) => line !== "") ?? fallback
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;

  return cause.message.trim() || fallback;
}

export async function blameWorkspaceFile(
  workspacePath: string,
  path: string,
): Promise<OperationOutput<"workspace.blame">> {
  const workspace = await realpath(workspacePath);
  const file = await resolveWorkspaceFile(workspace, path);
  const document = await readWorkspaceFile(workspace, file);

  if (document.kind !== "text")
    return { kind: "unsupported", message: "Blame requires a text file under 2 MB" };

  try {
    const repository = await runFileCommand({
      executable: "git",
      args: ["rev-parse", "--show-toplevel"],
      cwd: workspace,
    });

    if (repository.code !== 0)
      return { kind: "unsupported", message: "This workspace is not a Git repository" };

    const lineCount =
      document.contents.split("\n").length - (document.contents.endsWith("\n") ? 1 : 0);

    const range = document.contents === "" ? [] : ["-L", `1,${Math.min(lineCount, 10_001)}`];

    const result = await runFileCommand({
      executable: "git",
      args: [
        "--literal-pathspecs",
        "blame",
        "--line-porcelain",
        "--no-ext-diff",
        "--no-textconv",
        ...range,
        "--",
        relative(workspace, file),
      ],
      cwd: workspace,
    });

    if (result.code !== 0)
      return {
        kind: "error",
        message: commandMessage(result, "Git blame failed"),
      };
    const lines: WorkspaceBlameLine[] = [];
    const records = result.stdout.split("\n");
    let index = 0;

    while (index < records.length && records[index] !== "") {
      const header = /^(\^?[a-f0-9]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(records[index++] ?? "");

      if (header === null) throw new Error("Invalid Git blame header");
      const metadata = new Map<string, string>();

      while (index < records.length && !records[index]?.startsWith("\t")) {
        const line = records[index++] ?? "";
        const space = line.indexOf(" ");
        metadata.set(
          space < 0 ? line : line.slice(0, space),
          space < 0 ? "" : line.slice(space + 1),
        );
      }

      const contents = records[index++];
      const author = metadata.get("author");
      const authorMail = metadata.get("author-mail");
      const time = metadata.get("author-time");
      const summary = metadata.get("summary");
      const commit = header[1]?.replace(/^\^/, "");

      if (
        contents === undefined ||
        !contents.startsWith("\t") ||
        author === undefined ||
        authorMail === undefined ||
        time === undefined ||
        !/^-?\d+$/.test(time) ||
        summary === undefined ||
        commit === undefined
      )
        throw new Error("Incomplete Git blame record");

      if (lines.length >= 10_000) return { kind: "blame", path, lines, truncated: true };
      lines.push({
        line: Number(header[3]),
        originalLine: Number(header[2]),
        commit,
        author,
        authorMail: authorMail.replace(/^<|>$/g, ""),
        authorTime: Number(time),
        summary,
        contents: contents.slice(1),
        uncommitted: /^0+$/.test(commit),
      });
    }

    return { kind: "blame", path, lines, truncated: false };
  } catch (cause) {
    return {
      kind: "error",
      message: errorMessage(cause, "Git blame failed"),
    };
  }
}

const formatterPackage = Compile(
  Type.Object({
    bin: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Record(Type.String(), Type.String({ minLength: 1 })),
    ]),
  }),
);

async function workspaceFormatterBin(directory: string, formatter: string) {
  const manifest = join(
    directory,
    "node_modules",
    formatter === "biome" ? "@biomejs/biome" : formatter,
    "package.json",
  );

  if (!existsSync(manifest)) return undefined;
  const contents = await readFile(manifest, "utf8");
  const metadata = formatterPackage.Parse(JSON.parse(contents));
  const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin[formatter];

  if (bin === undefined) throw new Error(`${formatter} package does not declare its CLI bin`);
  const packageDirectory = dirname(await realpath(manifest));
  const executable = resolve(packageDirectory, bin);

  if (isAbsolute(bin) || !contains(packageDirectory, executable))
    throw new Error(`${formatter} CLI bin is outside its package`);

  return executable;
}

export async function formatWorkspaceFile(
  workspacePath: string,
  input: Omit<OperationInput<"workspace.format">, "target">,
): Promise<OperationOutput<"workspace.format">> {
  const file = await resolveWorkspaceFile(workspacePath, input.path);

  if (Buffer.byteLength(input.contents) > MAX_WORKSPACE_FILE_BYTES)
    return { kind: "error", message: "Contents exceed 2 MB" };
  const document = await readWorkspaceFile(workspacePath, file);

  if (document.kind !== "text")
    return { kind: "unsupported", message: "Formatting requires a text file under 2 MB" };

  if (document.version !== input.version) return { kind: "conflict" };
  const workspace = await realpath(workspacePath);
  let directory = dirname(file);

  while (true) {
    for (const formatter of ["prettier", "biome", "oxfmt"] as const) {
      try {
        const bin = await workspaceFormatterBin(directory, formatter);

        if (bin === undefined) continue;

        const result = await runFileCommand({
          executable: process.execPath,
          args: [
            bin,
            ...(formatter === "biome"
              ? ["format", `--stdin-file-path=${file}`]
              : ["--stdin-filepath", file]),
          ],
          cwd: workspace,
          stdin: input.contents,
          env: { ELECTRON_RUN_AS_NODE: "1" },
        });

        if (result.code !== 0)
          return {
            kind: "error",
            message: commandMessage(result, `${formatter} failed`),
          };

        if (Buffer.byteLength(result.stdout) > MAX_WORKSPACE_FILE_BYTES)
          return { kind: "error", message: "Formatted contents exceed 2 MB" };
        const current = await readWorkspaceFile(workspace, file);

        if (current.kind !== "text" || current.version !== input.version)
          return { kind: "conflict" };

        return { kind: "formatted", formatter, contents: result.stdout, version: input.version };
      } catch (cause) {
        return {
          kind: "error",
          message: errorMessage(cause, `${formatter} failed`),
        };
      }
    }

    const parent = dirname(directory);

    if (directory === workspace || parent === directory) break;
    directory = parent;
  }

  return {
    kind: "unsupported",
    message: "Install Prettier, Biome or Oxfmt in this workspace to format files",
  };
}

export async function saveWorkspaceFile(
  workspacePath: string,
  input: Omit<OperationInput<"workspace.save">, "target">,
): Promise<OperationOutput<"workspace.save">> {
  if (Buffer.byteLength(input.contents, "utf8") > MAX_WORKSPACE_FILE_BYTES)
    throw new WorkspaceFileError("too_large");
  const contents = Buffer.from(input.contents, "utf8");
  const file = await resolveWorkspaceFile(workspacePath, input.path);
  // Tabs in different views may share a disk version. Serialize the check and write,
  // not just the write, so only one of those drafts can acknowledge a successful save.
  const pending = pendingFileWrites.get(file);

  const write = (async (): Promise<OperationOutput<"workspace.save">> => {
    await pending?.catch(() => undefined);
    const handle = await openWorkspaceFile(workspacePath, file, true);

    try {
      const current = await readBounded(handle);

      if (current.kind === "too_large") throw new WorkspaceFileError("too_large");

      if (fileVersion(current.contents) !== input.version) return { kind: "conflict" };
      // Never reopen or truncate by path after checking the version. External
      // writers can still race this operation; only Nyte saves are serialized.
      let offset = 0;

      while (offset < contents.length) {
        const { bytesWritten } = await handle.write(
          contents,
          offset,
          contents.length - offset,
          offset,
        );

        if (bytesWritten === 0) throw new Error("Unable to write workspace file");
        offset += bytesWritten;
      }

      await handle.truncate(contents.length);

      return { kind: "saved", version: fileVersion(contents) };
    } finally {
      await handle.close();
    }
  })();

  pendingFileWrites.set(file, write);

  try {
    return await write;
  } finally {
    if (pendingFileWrites.get(file) === write) pendingFileWrites.delete(file);
  }
}
