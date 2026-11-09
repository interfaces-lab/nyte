import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import type { DocumentsApi } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/hash.ts";
import { localDocuments } from "../src/local/documents.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

type Row = {
  readonly name: string;
  act(documents: DocumentsApi, folder: string): Promise<unknown>;
  expected(folder: string): unknown;
};

const rows: readonly Row[] = [
  {
    name: "reads a text file by absolute path, without a scope",
    act: async (documents, folder) => {
      await writeFile(join(folder, "a.txt"), "hello\n");

      return documents.read(join(folder, "a.txt"));
    },
    expected: (folder) => ({
      kind: "text",
      path: join(folder, "a.txt"),
      mime: "text/plain",
      contents: "hello\n",
      version: sha256("hello\n"),
    }),
  },
  {
    name: "reads a binary file as its size and version",
    act: async (documents, folder) => {
      await writeFile(join(folder, "b.bin"), new Uint8Array([0, 1, 2]));

      return documents.read(join(folder, "b.bin"));
    },
    expected: (folder) => ({
      kind: "binary",
      path: join(folder, "b.bin"),
      mime: "application/octet-stream",
      size: 3,
      version: sha256(new Uint8Array([0, 1, 2])),
    }),
  },
  {
    name: "answers missing for a file that isn't there",
    act: (documents, folder) => documents.read(join(folder, "gone.md")),
    expected: (folder) => ({ kind: "missing", path: join(folder, "gone.md") }),
  },
  {
    name: "answers stale with the current version when expect doesn't match",
    act: async (documents, folder) => {
      await writeFile(join(folder, "c.md"), "one");

      return documents.write(join(folder, "c.md"), "two", { expect: "absent" });
    },
    expected: () => ({ kind: "stale", current: sha256("one") }),
  },
  {
    name: "refuses a relative path",
    act: async (documents) => documents.read("notes/a.md"),
    expected: () => ({ error: "invalid" }),
  },
  {
    name: "watches a named file and reports it by its absolute path",
    act: async (documents, folder) => {
      const iterator = documents.watch([join(folder, "d.md")])[Symbol.asyncIterator]();
      const next = iterator.next();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await writeFile(join(folder, "d.md"), "two");

      return (await next).value;
    },
    expected: (folder) => [{ kind: "created", path: join(folder, "d.md"), version: sha256("two") }],
  },
];

describe("localDocuments", () => {
  it.each(rows)(
    "$name",
    async (row) => {
      const folder = await realpath(await mkdtemp(join(tmpdir(), "nyte-documents-")));
      folders.push(folder);
      const closed = new AbortController();

      const answered = await row
        .act(localDocuments(closed.signal), folder)
        .catch((error: unknown) =>
          error instanceof SdkError ? { error: error.code } : Promise.reject(error),
        );

      closed.abort();
      expect(answered).toEqual(row.expected(folder));
    },
    20_000,
  );
});
