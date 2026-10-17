import { PatchEntrySchema, standard, writePatch } from "@nyte-ai/schema";
import type { Infer, PatchEntry, ToolContent } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "../contract/plugin.ts";
import type { ToolDefinition } from "../contract/tools.ts";
import type { FilesApi } from "../contract/workspace.ts";
import { textDigest } from "../util/content.ts";
import { lineDiff } from "../util/line-diff.ts";
import { followedTrace, traceparent } from "../util/trace.ts";

const READ_LINES = 2000;

const READ_CHARS = 50 * 1024;

const LIST_LIMIT = 500;

const SHELL_BYTES = 32 * 1024;

const PROGRESS_BYTES = 4 * 1024;

const MIME_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["bmp", "image/bmp"],
  ["svg", "image/svg+xml"],
  ["pdf", "application/pdf"],
]);

const readParameters = standard(
  Type.Object({
    path: Type.String({ description: "The file to read, relative to the workspace root." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "The first line to read, from 1." }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "How many lines to read." })),
  }),
);

const writeParameters = standard(
  Type.Object({
    path: Type.String({ description: "The file to write, relative to the workspace root." }),
    content: Type.String({ description: "The whole new contents of the file." }),
  }),
);

const editParameters = standard(
  Type.Object({
    path: Type.String({ description: "The file to edit, relative to the workspace root." }),
    edits: Type.Array(
      Type.Object({
        oldText: Type.String({ description: "Text that occurs exactly once in the file." }),
        newText: Type.String({ description: "The text that replaces it." }),
      }),
      { minItems: 1 },
    ),
  }),
);

const listParameters = standard(
  Type.Object({
    path: Type.Optional(
      Type.String({ description: "The directory to list; the workspace root by default." }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "How many entries to list." })),
  }),
);

const bashParameters = standard(
  Type.Object({
    command: Type.String({ description: "The shell command to run." }),
    description: Type.Optional(
      Type.String({ description: "What the command does, in a few words, for the user." }),
    ),
  }),
);

const read: ToolDefinition<Infer<typeof readParameters>> = {
  name: "read",
  description:
    "Read a file in the workspace. Text comes back as numbered lines; an image comes back as an image.",
  parameters: readParameters,
  class: (args) => ({ kind: "read", path: args.path }),
  effects: "none",
  replay: "safe",
  async execute(args, invocation) {
    const { files } = invocation.env;

    const document = await files.read(args.path);

    if (document.kind === "missing") return text(`${args.path} does not exist.`);

    if (document.kind === "text") return text(numbered(args.path, document.contents, args));

    return {
      content: [
        { kind: "text", text: `${args.path} is ${document.kind}: ${document.size} bytes.` },
        await upload(files, args.path),
      ],
    };
  },
};

const write: ToolDefinition<Infer<typeof writeParameters>, PatchEntry> = {
  name: "write",
  description:
    "Write a file in the workspace, creating missing directories. Replaces the whole file.",
  parameters: writeParameters,
  output: PatchEntrySchema,
  class: (args) => ({ kind: "edit", path: args.path }),
  replay: "safe",
  async execute(args, invocation) {
    const { files } = invocation.env;
    const previous = await files.read(args.path);
    const outcome = await files.write(args.path, args.content, { parents: true });

    if (outcome.kind !== "saved") throw new Error(`Could not write ${args.path}: ${outcome.kind}.`);

    const result = text(
      `Wrote ${new TextEncoder().encode(args.content).byteLength} bytes to ${args.path}.`,
    );

    if (previous.kind === "binary" || previous.kind === "large") return result;
    const before = previous.kind === "text" ? previous.contents : null;

    return { ...result, output: await createTextPatch(args.path, before, args.content) };
  },
};

const edit: ToolDefinition<Infer<typeof editParameters>, PatchEntry> = {
  name: "edit",
  description:
    "Edit a file in the workspace by exact replacement. Each oldText must match exactly one place in the file, and edits must not overlap.",
  parameters: editParameters,
  output: PatchEntrySchema,
  class: (args) => ({ kind: "edit", path: args.path }),
  replay: "safe",
  async execute(args, invocation) {
    const { files } = invocation.env;
    const document = await files.read(args.path);

    if (document.kind !== "text")
      throw new Error(`${args.path} is ${document.kind}, not a text file.`);
    const { contents } = document;

    const spans = args.edits.map((change, index) => {
      const starts =
        change.oldText === ""
          ? []
          : Array.from(
              contents.matchAll(new RegExp(`(?=${RegExp.escape(change.oldText)})`, "g")),
              (match) => match.index,
            );
      const [start] = starts;

      if (start === undefined)
        throw new Error(`Edit ${index + 1}: no match for oldText in ${args.path}.`);

      if (starts.length > 1)
        throw new Error(
          `Edit ${index + 1}: oldText occurs ${starts.length} times in ${args.path}; make it unique.`,
        );

      return { start, end: start + change.oldText.length, newText: change.newText, index };
    });

    const ordered = [...spans].sort((left, right) => left.start - right.start);

    for (const [position, span] of ordered.entries()) {
      const next = ordered[position + 1];

      if (next !== undefined && next.start < span.end)
        throw new Error(`Edits ${span.index + 1} and ${next.index + 1} overlap in ${args.path}.`);
    }

    const edited = ordered.reduceRight(
      (current, span) => current.slice(0, span.start) + span.newText + current.slice(span.end),
      contents,
    );

    const outcome = await files.write(args.path, edited, { expect: document.version });

    if (outcome.kind === "stale")
      throw new Error(`${args.path} changed while it was being edited; read it again.`);

    if (outcome.kind !== "saved") throw new Error(`Could not write ${args.path}: ${outcome.kind}.`);

    return {
      ...text(
        `Edited ${args.path}: ${spans.length} ${spans.length === 1 ? "replacement" : "replacements"}.`,
      ),
      output: await createTextPatch(args.path, contents, edited),
    };
  },
};

const list: ToolDefinition<Infer<typeof listParameters>> = {
  name: "list",
  description: "List a directory in the workspace, one entry per line; directories end in /.",
  parameters: listParameters,
  class: (args) => ({ kind: "list", path: args.path ?? "." }),
  effects: "none",
  replay: "safe",
  async execute(args, invocation) {
    const directory = (args.path ?? ".").replace(/^\.\/?/, "").replace(/\/+$/, "");
    const limit = args.limit ?? LIST_LIMIT;
    const names = new Set<string>();
    let incomplete = false;

    for await (const frame of invocation.env.files.scan({
      directory: directory === "" ? undefined : directory,
      ignored: "exclude",
    })) {
      if (frame.kind === "incomplete") incomplete = true;

      if (frame.kind !== "entries") continue;

      for (const entry of frame.entries) {
        const relative =
          directory !== "" && entry.path.startsWith(`${directory}/`)
            ? entry.path.slice(directory.length + 1)
            : entry.path;

        if (relative !== "" && !relative.includes("/"))
          names.add(entry.kind === "directory" ? `${relative}/` : relative);
      }
    }

    const sorted = [...names].sort();
    const shown = sorted.slice(0, limit);
    const more = sorted.length - shown.length;

    const notes = [
      ...(more > 0 ? [`… ${more} more entries not shown.`] : []),
      ...(incomplete ? ["The listing stopped early; some entries may be missing."] : []),
    ];

    return text(
      shown.length === 0 && notes.length === 0
        ? `${args.path ?? "."} is empty.`
        : [...shown, ...notes].join("\n"),
    );
  },
};

const bash: ToolDefinition<Infer<typeof bashParameters>> = {
  name: "bash",
  description:
    "Run a shell command in the workspace root and return its output and exit code. Long output keeps its end.",
  parameters: bashParameters,
  class: (args) =>
    args.description === undefined
      ? { kind: "shell", command: args.command }
      : { kind: "shell", command: args.command, description: args.description },
  replay: "never",
  async execute(args, invocation) {
    const { env } = invocation;
    const trace = followedTrace(invocation.session.id);

    const job = await env.exec(args.command, {
      cwd: env.cwd,
      signal: invocation.signal,
      env: trace === null ? undefined : { TRACEPARENT: traceparent(trace) },
    });

    const chunks: Uint8Array[] = [];
    let kept = 0;
    let dropped = 0;
    let code: number | null = null;

    for await (const frame of job.output()) {
      if (frame.kind === "exit") {
        code = frame.code;

        break;
      }

      if (frame.kind === "gap") continue;
      chunks.push(frame.data);
      kept += frame.data.byteLength;

      while (kept - (chunks[0]?.byteLength ?? 0) >= SHELL_BYTES && chunks.length > 1) {
        const first = chunks.shift();
        kept -= first?.byteLength ?? 0;
        dropped += first?.byteLength ?? 0;
      }

      invocation.progress({ text: decodeOutputTail(chunks, PROGRESS_BYTES) });
    }

    const end = await job.settled();
    const exit = end.kind === "exited" ? (end.code ?? code) : code;
    const joined = joinBytes(chunks);
    const cut = Math.max(0, joined.byteLength - SHELL_BYTES);
    const output = new TextDecoder().decode(joined.subarray(cut)).trimEnd();

    const truncated =
      dropped + cut > 0
        ? [`[truncated: the first ${dropped + cut} bytes of output are not shown]`]
        : [];

    const status =
      end.kind === "lost"
        ? "[the process was lost]"
        : `[exit code ${exit ?? "none"}${end.reason === "exited" ? "" : `, ${end.reason}`}]`;

    return text([...truncated, ...(output === "" ? [] : [output]), status].join("\n"));
  },
};

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

function decodeOutputTail(chunks: readonly Uint8Array[], limit: number): string {
  const tail: Uint8Array[] = [];
  let size = 0;

  for (const chunk of chunks.toReversed()) {
    if (size >= limit) break;
    tail.unshift(chunk);
    size += chunk.byteLength;
  }

  const text = new TextDecoder().decode(joinBytes(tail).subarray(Math.max(0, size - limit)));

  const [, ...whole] = text.split("\n");

  return (size > limit && whole.length > 0 ? whole.join("\n") : text).trimEnd();
}

export const environmentPlugin: Plugin<"core"> = {
  id: "environment",
  contribute: { tools: [read, write, edit, list, bash] },
  activate(api) {
    const cwd = tryReadCwd(() => api.env);

    if (cwd !== null)
      api.contribute.prompt.add({
        id: "cwd",
        order: 100,
        text: `The workspace root is ${cwd}. Tool paths are relative to it.`,
      });
  },
};

function text(value: string) {
  return { content: [{ kind: "text", text: value } satisfies ToolContent] };
}

async function createTextPatch(
  path: string,
  before: string | null,
  after: string,
): Promise<PatchEntry> {
  const status = before === null ? "added" : "modified";
  const digest = await textDigest(`${before ?? ""}\u0000${after}`);
  const { hunks, added, removed } = lineDiff(before ?? "", after);

  if (hunks.length === 0) return { path, status, digest, kind: "empty" };

  return {
    path,
    status,
    digest,
    kind: "text",
    added,
    removed,
    patch: writePatch(path, status, hunks),
  };
}

function tryReadCwd(env: () => { readonly cwd: string }): string | null {
  try {
    return env().cwd;
  } catch {
    return null;
  }
}

function numbered(
  path: string,
  contents: string,
  args: { readonly offset?: number; readonly limit?: number },
): string {
  const lines = contents.split("\n");

  if (lines.at(-1) === "") lines.pop();
  const first = args.offset ?? 1;

  if (lines.length === 0) return `${path} is empty.`;

  if (first > lines.length)
    return `${path} has ${lines.length} lines; offset ${first} is past the end.`;
  const shown: string[] = [];
  let size = 0;
  const last = Math.min(lines.length, first - 1 + (args.limit ?? READ_LINES));

  for (let number = first; number <= last; number += 1) {
    const line = `${String(number).padStart(6)}\t${lines[number - 1] ?? ""}`;

    if (size + line.length > READ_CHARS && shown.length > 0) break;
    shown.push(line);
    size += line.length + 1;
  }

  const through = first + shown.length - 1;

  return through < lines.length
    ? `${shown.join("\n")}\n… ${lines.length - through} more lines; continue with offset ${through + 1}.`
    : shown.join("\n");
}

async function upload(files: FilesApi, path: string): Promise<ToolContent> {
  const reader = await files.bytes(path);

  try {
    const blob = await files.upload(reader.chunks());
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();

    return {
      kind: "file",
      blob,
      mime: reader.mime ?? MIME_TYPES.get(extension) ?? "application/octet-stream",
      name: path.slice(path.lastIndexOf("/") + 1),
    };
  } finally {
    await reader.close();
  }
}
