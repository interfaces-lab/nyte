import { OPERATIONS } from "../../src/index.ts";
import { fileVersion, operation } from "./fixtures.ts";
import type { Case } from "./fixtures.ts";

export const documentOperations = {
  "documents.read input": operation(
    OPERATIONS["documents.read"].input,
    { path: "/notes/a.md", options: { as: "document" } },
    { path: "/notes/a.md", options: { as: "bytes" } },
  ),
  "documents.read output": operation(
    OPERATIONS["documents.read"].output,
    { kind: "missing", path: "/notes/a.md" },
    { kind: "missing" },
  ),
  "documents.bytes input": operation(OPERATIONS["documents.bytes"].input, { path: "/a.png" }, {}),
  "documents.bytes output": operation(
    OPERATIONS["documents.bytes"].output,
    "",
    "%%",
    new Uint8Array(),
  ),
  "documents.write input": operation(
    OPERATIONS["documents.write"].input,
    { path: "/notes/a.md", options: { expect: fileVersion, parents: true } },
    { path: "/notes/a.md", options: { expect: 1 } },
  ),
  "documents.write output": operation(
    OPERATIONS["documents.write"].output,
    { kind: "saved", version: fileVersion },
    { kind: "saved" },
  ),
  "documents.watch input": operation(
    OPERATIONS["documents.watch"].input,
    { paths: ["/notes/a.md"] },
    { paths: "/notes/a.md" },
  ),
  "documents.watch output": operation(
    OPERATIONS["documents.watch"].output,
    [{ path: "/notes/a.md", version: fileVersion, kind: "modified" }],
    [{ path: "/notes/a.md", kind: "modified" }],
  ),
} satisfies Record<string, Case>;
