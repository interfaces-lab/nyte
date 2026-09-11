import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { Script } from "node:vm";
import { setTimeout } from "node:timers/promises";
import { discoverMentionFiles } from "@nyte-ai/core";
import { Compile } from "typebox/compile";
import { Type } from "typebox";
import type {
  WorkspaceBlameLine,
  WorkspaceBlameResult,
  WorkspaceEditorBridge,
  WorkspaceFormatInput,
  WorkspaceFormatResult,
  WorkspaceSearchInput,
  WorkspaceSearchResult,
} from "../shared/workspace-editor.ts";
import type { WorkspaceEditorRequest } from "../shared/ipc.ts";
import { WORKSPACE_EDITOR_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { TextDecoder } from "node:util";
import type { WorkspaceFileDocument, WorkspaceFileSaveOutcome } from "../shared/ipc.ts";
import { ExpectedHostError, ipcFailure } from "./errors.ts";

const MAX_WORKSPACE_FILE_BYTES = 2_000_000;
const pendingFileWrites = new Map<string, Promise<WorkspaceFileSaveOutcome>>();

function fileVersion(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function workspaceFilePath(workspacePath: string, path: string): Promise<string> {
  const [workspace, file] = await Promise.all([
    realpath(workspacePath),
    realpath(resolve(workspacePath, path)),
  ]);
  const inside = relative(workspace, file);
  if (inside === "" || isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) {
    throw new ExpectedHostError({
      code: "forbidden",
      message: "File is outside the open workspace",
    });
  }
  if (!(await lstat(file)).isFile())
    throw new ExpectedHostError({
      code: "invalid_input",
      message: "Path is not a file",
      issues: [],
    });
  return file;
}

export async function readWorkspaceFile(
  workspacePath: string,
  path: string,
): Promise<WorkspaceFileDocument> {
  const file = await workspaceFilePath(workspacePath, path);
  // Read through a bounded handle so a growing file cannot allocate unbounded memory.
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    if (size > MAX_WORKSPACE_FILE_BYTES) return { kind: "too_large", path, size };
    const buffer = Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_WORKSPACE_FILE_BYTES) return { kind: "too_large", path, size: length };
    const contents = buffer.subarray(0, length);
    if (contents.includes(0)) return { kind: "binary", path, size: length };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      return { kind: "binary", path, size: length };
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
  const file = await workspaceFilePath(workspacePath, input.path);
  // Tabs in different views may share a disk version. Serialize the check and write,
  // not just the write, so only one of those drafts can acknowledge a successful save.
  const pending = pendingFileWrites.get(file);
  const write = (async (): Promise<WorkspaceFileSaveOutcome> => {
    await pending?.catch(() => undefined);
    const current = await readFile(file);
    if (fileVersion(current) !== input.version) return { kind: "conflict" };
    const contents = Buffer.from(input.contents, "utf8");
    if (contents.byteLength > MAX_WORKSPACE_FILE_BYTES) {
      throw new ExpectedHostError({
        code: "payload_too_large",
        message: "File is too large to save in the workbench",
      });
    }
    await writeFile(file, contents);
    return { kind: "saved", version: fileVersion(contents) };
  })();
  pendingFileWrites.set(file, write);
  try {
    return await write;
  } finally {
    if (pendingFileWrites.get(file) === write) pendingFileWrites.delete(file);
  }
}

const searchMatches = Compile(
  Type.Array(
    Type.Object({
      line: Type.Integer(),
      column: Type.Integer(),
      length: Type.Integer(),
      snippet: Type.String(),
      snippetColumn: Type.Integer(),
    }),
  ),
);

// Construct and run regexes inside the timed VM, not on Electron's unbounded main stack.
// No workspace code or interpolated source enters this script.
const searchScript = new Script(`
  const expression = new RegExp(pattern, flags);
  const wordBefore = /[\\p{L}\\p{N}_]$/u;
  const wordAfter = /^[\\p{L}\\p{N}_]/u;
  const matches = [];
  const lines = text.split(/\\r?\\n/);
  outer: for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!wholeWord || (!wordBefore.test(line.slice(0, start)) && !wordAfter.test(line.slice(end)))) {
        const snippetStart = Math.max(0, start - 80);
        matches.push({ line: index + 1, column: start + 1, length: match[0].length,
          snippet: line.slice(snippetStart, snippetStart + 240), snippetColumn: snippetStart + 1 });
        if (matches.length >= limit) break outer;
      }
      if (match[0].length === 0) {
        const point = line.codePointAt(expression.lastIndex);
        expression.lastIndex += point !== undefined && point > 0xffff ? 2 : 1;
      }
    }
  }
  matches;
`);

export async function searchWorkspaceFiles(
  workspacePath: string,
  input: WorkspaceSearchInput,
  signal: AbortSignal = new AbortController().signal,
): Promise<WorkspaceSearchResult> {
  const pattern =
    input.regex === true ? input.query : input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = input.caseSensitive === true ? "gu" : "giu";
  try {
    new RegExp(pattern, flags);
  } catch {
    throw new ExpectedHostError({
      code: "invalid_input",
      message: "Invalid search regular expression",
      issues: [],
    });
  }
  const started = performance.now();
  const drafts = new Map<string, string>();
  let draftBytes = 0;
  for (const draft of input.drafts ?? []) {
    draftBytes += Buffer.byteLength(draft.contents);
    if (draftBytes > MAX_WORKSPACE_FILE_BYTES)
      throw new ExpectedHostError({
        code: "payload_too_large",
        message: "Search drafts exceed 2 MB",
      });
    drafts.set(await workspaceFilePath(workspacePath, draft.path), draft.contents);
  }
  signal.throwIfAborted();
  const candidates = await discoverMentionFiles(workspacePath);
  const files: WorkspaceSearchResult["files"][number][] = [];
  const skipped = { binary: 0, tooLarge: 0, unreadable: 0 };
  const maxMatches = input.maxMatches ?? 500;
  let matchCount = 0;
  let bytes = 0;
  // The mention API currently caps at 5,000 entries without carrying completion metadata.
  let truncated = candidates.length >= 5_000;
  for (const candidate of candidates) {
    await setTimeout(0, undefined, { signal });
    if (performance.now() - started > 5_000 || bytes >= 50_000_000) {
      truncated = true;
      break;
    }
    if (candidate.displayPath.endsWith("/")) continue;
    if (
      input.include !== undefined &&
      input.include.length > 0 &&
      !input.include.some((glob) => matchesGlob(candidate.displayPath, glob))
    )
      continue;
    if (input.exclude?.some((glob) => matchesGlob(candidate.displayPath, glob)) === true) continue;
    let document: WorkspaceFileDocument;
    let draft: string | undefined;
    try {
      const file = await workspaceFilePath(workspacePath, candidate.path);
      draft = drafts.get(file);
      document =
        draft === undefined
          ? await readWorkspaceFile(workspacePath, file)
          : { kind: "text", path: file, contents: draft, version: "" };
    } catch {
      skipped.unreadable += 1;
      continue;
    }
    if (document.kind === "binary") {
      skipped.binary += 1;
      continue;
    }
    if (document.kind === "too_large") {
      skipped.tooLarge += 1;
      continue;
    }
    if (document.contents.includes("\0")) {
      skipped.binary += 1;
      continue;
    }
    bytes += Buffer.byteLength(document.contents);
    let matches: ReturnType<typeof searchMatches.Parse>;
    try {
      matches = searchMatches.Parse(
        searchScript.runInNewContext(
          {
            pattern,
            flags,
            wholeWord: input.wholeWord === true,
            text: document.contents,
            limit: maxMatches - matchCount + 1,
          },
          { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } },
        ),
      );
    } catch {
      throw new ExpectedHostError({
        code: "invalid_input",
        message: "Search pattern exceeded its execution limit; simplify the expression",
        issues: [],
      });
    }
    signal.throwIfAborted();
    if (matches.length === 0) continue;
    const remaining = maxMatches - matchCount;
    if (matches.length > remaining) truncated = true;
    const kept = Array.from(matches.slice(0, remaining), (match) => ({ ...match }));
    if (kept.length > 0)
      files.push({
        path: candidate.path,
        displayPath: candidate.displayPath,
        source: draft === undefined ? "disk" : "draft",
        matches: kept,
      });
    matchCount += kept.length;
    if (matches.length > remaining) break;
  }
  return { files, matchCount, truncated, skipped };
}

/** Fixed executable and argument arrays only. stdin formatting cannot replace the disk file. */
function runFileCommand(input: {
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
    // Early process failure can close stdin before all contents have been written.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.stdin);
  });
}

export async function blameWorkspaceFile(
  workspacePath: string,
  path: string,
): Promise<WorkspaceBlameResult> {
  const workspace = await realpath(workspacePath);
  const file = await workspaceFilePath(workspace, path);
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
        message: ipcFailure(result).message,
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
      message: ipcFailure(cause).message,
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
  // Inspect only this workspace's installation, never Node's parent or global search paths.
  const manifest = join(
    directory,
    "node_modules",
    formatter === "biome" ? "@biomejs/biome" : formatter,
    "package.json",
  );
  const contents = await readFile(manifest, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  });
  if (contents === undefined) return undefined;
  const metadata = formatterPackage.Parse(JSON.parse(contents));
  const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin[formatter];
  if (bin === undefined) throw new Error(`${formatter} package does not declare its CLI bin`);
  const packageDirectory = dirname(await realpath(manifest));
  const executable = resolve(packageDirectory, bin);
  const inside = relative(packageDirectory, executable);
  if (
    isAbsolute(bin) ||
    inside === "" ||
    isAbsolute(inside) ||
    inside === ".." ||
    inside.startsWith(`..${sep}`)
  )
    throw new Error(`${formatter} CLI bin is outside its package`);
  return executable;
}

export async function formatWorkspaceFile(
  workspacePath: string,
  input: WorkspaceFormatInput,
): Promise<WorkspaceFormatResult> {
  const file = await workspaceFilePath(workspacePath, input.path);
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
        // These packages expose JavaScript CLIs. Biome's wrapper selects its native binary.
        // Electron's Node mode avoids PATH's Node and Windows .cmd shims entirely.
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
            message: ipcFailure(result).message,
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
          message: ipcFailure(cause).message,
        };
      }
    }
    if (directory === workspace) break;
    directory = dirname(directory);
  }
  return {
    kind: "unsupported",
    message: "Install Prettier, Biome or Oxfmt in this workspace to format files",
  };
}

/** Window-owned requests capture cwd once; switching workspaces cannot retarget an active read. */
export function createWorkspaceEditor(dependencies: {
  readonly workspace: () => Promise<string>;
  readonly requireTrust: (workspacePath: string) => Promise<void>;
}) {
  const searches = new Map<string, AbortController>();
  const bridge: WorkspaceEditorBridge = {
    async search(input) {
      const parsed = WORKSPACE_EDITOR_INPUT_SCHEMAS.search.Parse(input);
      if (searches.has(parsed.requestId))
        throw new ExpectedHostError({
          code: "invalid_input",
          message: "Search request id is already active",
          issues: [],
        });
      if (searches.size >= 4)
        throw new ExpectedHostError({
          code: "invalid_input",
          message: "Too many active workspace searches",
          issues: [],
        });
      const controller = new AbortController();
      searches.set(parsed.requestId, controller);
      try {
        return await searchWorkspaceFiles(
          await dependencies.workspace(),
          parsed,
          controller.signal,
        );
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new ExpectedHostError({ code: "closed", message: "Workspace search aborted." });
        }
        throw cause;
      } finally {
        searches.delete(parsed.requestId);
      }
    },
    async cancelSearch(input) {
      searches.get(WORKSPACE_EDITOR_INPUT_SCHEMAS.cancelSearch.Parse(input).requestId)?.abort();
    },
    async blame(input) {
      const parsed = WORKSPACE_EDITOR_INPUT_SCHEMAS.blame.Parse(input);
      return blameWorkspaceFile(await dependencies.workspace(), parsed.path);
    },
    async format(input) {
      const parsed = WORKSPACE_EDITOR_INPUT_SCHEMAS.format.Parse(input);
      const workspace = await dependencies.workspace();
      await dependencies.requireTrust(workspace);
      return formatWorkspaceFile(workspace, parsed);
    },
  };
  return {
    async call(request: WorkspaceEditorRequest) {
      switch (request.operation) {
        case "search":
          return bridge.search(request.input);
        case "cancelSearch":
          return bridge.cancelSearch(request.input);
        case "blame":
          return bridge.blame(request.input);
        case "format":
          return bridge.format(request.input);
      }
    },
    dispose() {
      for (const controller of searches.values()) controller.abort();
    },
  };
}
