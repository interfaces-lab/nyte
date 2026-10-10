import { standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "../plugin.ts";
import type { ToolDefinition } from "../tools.ts";

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

/** Reads a file through `env.files.read`: text as numbered lines from `offset` for `limit` lines (bounded), an image stored with `files.upload` and returned as `file` content, a binary or large file as its kind and size, a missing file as `failed`. */
const read: ToolDefinition<Infer<typeof readParameters>> = {
  name: "read",
  description:
    "Read a file in the workspace. Text comes back as numbered lines; an image comes back as an image.",
  parameters: readParameters,
  class: (args) => ({ kind: "read", path: args.path }),
  replay: "safe",
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Writes a whole file through `env.files.write` with `parents`; replaying writes the same content again. */
const write: ToolDefinition<Infer<typeof writeParameters>> = {
  name: "write",
  description:
    "Write a file in the workspace, creating missing directories. Replaces the whole file.",
  parameters: writeParameters,
  class: (args) => ({ kind: "edit", path: args.path }),
  replay: "safe",
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Edits a text file by exact replacement against the version it read: every `oldText` must occur exactly once in the current contents and no two may overlap, else `failed` naming the edit and nothing is written; the result is written with `expect` set to that version, a `stale` answer failing the call. A replay whose `newText`s are already in place and whose `oldText`s are gone succeeds without writing. */
const edit: ToolDefinition<Infer<typeof editParameters>> = {
  name: "edit",
  description:
    "Edit a file in the workspace by exact replacement. Each oldText must match exactly one place in the file, and edits must not overlap.",
  parameters: editParameters,
  class: (args) => ({ kind: "edit", path: args.path }),
  replay: "safe",
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Lists one directory through `env.files.scan` with ignored entries excluded: one entry per line, directories ending in `/`, at most `limit`, noting when more remain. */
const list: ToolDefinition<Infer<typeof listParameters>> = {
  name: "list",
  description: "List a directory in the workspace, one entry per line; directories end in /.",
  parameters: listParameters,
  class: (args) => ({ kind: "list", path: args.path ?? "." }),
  replay: "safe",
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Runs a command through `env.exec` in the workspace root, tied to the call's signal: output and exit code, the output bounded to its last 50 KiB with the cut noted. Never replayed: after a crash the call settles `interrupted`. */
const bash: ToolDefinition<Infer<typeof bashParameters>> = {
  name: "bash",
  description:
    "Run a shell command in the workspace root and return its output and exit code. Long output keeps its end.",
  parameters: bashParameters,
  class: (args) => ({ kind: "shell", command: args.command, description: args.description }),
  replay: "never",
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Contributes the workspace tools (decision 13): `read` (class read), `write` and `edit` (class edit), `list` (class list) and `bash` (class shell); and, at activation, the prompt section `cwd` (order 100) naming the session environment's `cwd`, left out when the session has no environment. */
export const environmentPlugin: Plugin<"core"> = {
  id: "environment",
  contribute: { tools: [read, write, edit, list, bash] },
  activate(api) {
    throw new Error("not implemented");
  },
};
