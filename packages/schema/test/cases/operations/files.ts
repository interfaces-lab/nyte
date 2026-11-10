import { OPERATIONS, asId } from "../../../src/index.ts";
import {
  operation,
  receipt,
  workspace,
  fileVersion,
  workspaceInput,
  pathInput,
  fileEntry,
} from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

export const fileOperations = {
  "files.read input": operation(OPERATIONS["files.read"].input, pathInput, { workspace }),
  "files.bytes input": operation(OPERATIONS["files.bytes"].input, pathInput, { path: "a.ts" }),
  "files.bytes output": operation(OPERATIONS["files.bytes"].output, "", "%%", new Uint8Array()),
  "files.stat input": operation(OPERATIONS["files.stat"].input, pathInput, {}),
  "files.stat output": operation(
    OPERATIONS["files.stat"].output,
    { kind: "symlink", size: 4, version: fileVersion, target: "b.ts" },
    { kind: "socket", size: 4, version: fileVersion },
  ),
  "files.write input": operation(
    OPERATIONS["files.write"].input,
    { ...pathInput, options: { expect: "absent", parents: true } },
    { ...pathInput, options: { expect: 1 } },
  ),
  "files.remove input": operation(
    OPERATIONS["files.remove"].input,
    { ...pathInput, options: { expect: fileVersion } },
    { ...pathInput, options: { expect: null } },
  ),
  "files.move input": operation(
    OPERATIONS["files.move"].input,
    { workspace, from: "src/a", to: "src/b" },
    { workspace, from: "src/a" },
  ),
  "files.copy input": operation(
    OPERATIONS["files.copy"].input,
    { workspace, from: "src/a.ts", to: "src/a copy.ts" },
    { workspace, to: "src/b" },
  ),
  "files.mkdir input": operation(OPERATIONS["files.mkdir"].input, pathInput, { workspace }),
  "files.trash input": operation(OPERATIONS["files.trash"].input, pathInput, {
    workspace,
    path: 1,
  }),
  "files.restore input": operation(
    OPERATIONS["files.restore"].input,
    { workspace, token: asId<"trash">("t1") },
    { workspace },
  ),
  "files.batch input": operation(
    OPERATIONS["files.batch"].input,
    {
      workspace,
      id: receipt,
      entries: [
        { kind: "put", path: "a.ts", contents: "x", expect: "absent" },
        { kind: "remove", path: "b.ts", expect: fileVersion },
        { kind: "move", path: "c", to: "d" },
        { kind: "copy", path: "d", to: "e" },
        { kind: "mkdir", path: "f" },
      ],
    },
    { workspace, entries: [{ kind: "move", path: "a.ts" }] },
  ),
  "files.batch output": operation(OPERATIONS["files.batch"].output, { receipt }, { receipt: null }),
  "files.format input": operation(
    OPERATIONS["files.format"].input,
    { ...pathInput, contents: "x" },
    pathInput,
  ),
  "files.scan input": operation(
    OPERATIONS["files.scan"].input,
    { workspace, directory: "src", ignored: "include" },
    { workspace, ignored: "all" },
  ),
  "files.find input": operation(
    OPERATIONS["files.find"].input,
    { workspace, query: "parser", limit: 5 },
    { workspace },
  ),
  "files.find output": operation(OPERATIONS["files.find"].output, [fileEntry], [{ path: "a.ts" }]),
  "files.search input": operation(
    OPERATIONS["files.search"].input,
    {
      workspace,
      query: "TODO",
      caseSensitive: true,
      wholeWord: true,
      regex: true,
      include: ["src/**"],
      exclude: ["**/*.test.*"],
      drafts: [{ path: "a.ts", contents: "TODO" }],
    },
    { workspace, query: "TODO", include: "src/**" },
  ),
  "files.watch input": operation(
    OPERATIONS["files.watch"].input,
    { workspace, paths: ["src"] },
    { workspace, paths: "src" },
  ),
  "files.watch output": operation(
    OPERATIONS["files.watch"].output,
    [{ path: "a.ts", version: null, kind: "removed" }],
    [{ path: "a.ts", kind: "removed" }],
  ),
  "files.upload input": operation(OPERATIONS["files.upload"].input, workspaceInput, {}),
} satisfies Record<string, Case>;
