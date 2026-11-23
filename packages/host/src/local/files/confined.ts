import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FilesApi } from "@nyte-ai/core";

const reader = String.raw`
import json, os, stat, sys
request = json.load(sys.stdin)
root = os.open(request["root"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
root_stat = os.fstat(root)
if str(root_stat.st_dev) != request["device"] or str(root_stat.st_ino) != request["inode"]:
    raise ValueError("workspace identity changed")
parts = request["path"].split("/")
if any(part in ("", ".", "..", ".nyte", ".git", ".ssh", ".aws") for part in parts):
    raise ValueError("path is not confined")
current = root
try:
    for part in parts[:-1]:
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
        if current != root:
            os.close(current)
        current = child
    file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
    try:
        info = os.fstat(file)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
            raise ValueError("not a bounded regular file")
        content = bytearray()
        while len(content) <= 1048576:
            chunk = os.read(file, min(65536, 1048577 - len(content)))
            if not chunk:
                break
            content.extend(chunk)
        if len(content) > 1048576 or b"\x00" in content:
            raise ValueError("not bounded text")
        text = content.decode("utf-8", errors="strict")
        if request.get("line") is not None or request.get("limit") is not None:
            start = request.get("line", 1) - 1
            end = None if request.get("limit") is None else start + request["limit"]
            text = "".join(text.splitlines(keepends=True)[start:end])
        sys.stdout.write(text)
    finally:
        os.close(file)
finally:
    if current != root:
        os.close(current)
    os.close(root)
`;

/** Offers confined reads only where an installed dir-fd helper can open every component without following links. */
export async function confinedReader(root: string): Promise<FilesApi["readConfined"]> {
  if (process.platform === "win32") return undefined;
  const python = "/usr/bin/python3";

  if (
    !(await access(python, constants.X_OK).then(
      () => true,
      () => false,
    ))
  ) {
    return undefined;
  }
  const identity = await stat(root, { bigint: true });

  return async (input) => {
    if (
      input.path.includes("\0") ||
      input.path.includes("://") ||
      (input.line !== undefined && (!Number.isSafeInteger(input.line) || input.line < 1)) ||
      (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1))
    ) {
      throw new Error("Invalid confined read.");
    }
    const path = isAbsolute(input.path) ? relative(root, input.path) : input.path;
    const resolved = resolve(root, path);

    if (
      !resolved.startsWith(`${root}${sep}`) ||
      path.split(sep).some((part) => part === ".." || part === "")
    ) {
      throw new Error("The requested file is outside the workspace.");
    }
    input.signal.throwIfAborted();

    const child = spawn(python, ["-I", "-c", reader], {
      stdio: "pipe",
      env: {},
      signal: input.signal,
    });

    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;

      if (bytes > 1024 * 1024) {
        exceeded = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.resume();

    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        root,
        device: String(identity.dev),
        inode: String(identity.ino),
        path: path.split(sep).join("/"),
        line: input.line,
        limit: input.limit,
      }),
    );

    if ((await exit) !== 0 || exceeded) {
      throw new Error("The file could not be read as confined workspace text.");
    }
    return { content: Buffer.concat(chunks).toString("utf8") };
  };
}
