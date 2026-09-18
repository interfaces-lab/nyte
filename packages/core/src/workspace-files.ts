import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import type { WorkspaceFileDocument, WorkspaceFileSaveOutcome } from "@nyte-ai/protocol";

const fileErrors = {
  outside_workspace: "File is outside the open workspace",
  not_file: "Path is not a file",
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
const pendingFileWrites = new Map<string, Promise<WorkspaceFileSaveOutcome>>();

function fileVersion(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export async function resolveWorkspaceFile(workspacePath: string, path: string): Promise<string> {
  const [workspace, file] = await Promise.all([
    realpath(workspacePath),
    realpath(resolve(workspacePath, path)),
  ]);
  const inside = relative(workspace, file);
  if (inside === "" || isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) {
    throw new WorkspaceFileError("outside_workspace");
  }
  if (!(await lstat(file)).isFile()) throw new WorkspaceFileError("not_file");
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
): Promise<WorkspaceFileDocument> {
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

export async function saveWorkspaceFile(
  workspacePath: string,
  input: { readonly path: string; readonly contents: string; readonly version: string },
): Promise<WorkspaceFileSaveOutcome> {
  if (Buffer.byteLength(input.contents, "utf8") > MAX_WORKSPACE_FILE_BYTES)
    throw new WorkspaceFileError("too_large");
  const contents = Buffer.from(input.contents, "utf8");
  const file = await resolveWorkspaceFile(workspacePath, input.path);
  // Tabs in different views may share a disk version. Serialize the check and write,
  // not just the write, so only one of those drafts can acknowledge a successful save.
  const pending = pendingFileWrites.get(file);
  const write = (async (): Promise<WorkspaceFileSaveOutcome> => {
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
