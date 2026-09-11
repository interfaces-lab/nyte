import { expect, test } from "vitest";
import type { WorkspaceFileSaveOutcome } from "../../../shared/ipc.ts";
import type { WorkspaceFormatResult } from "../../../shared/workspace-editor.ts";
import { createFileDocument } from "./file-document.ts";

const document = {
  kind: "text",
  path: "/workspace/file.ts",
  contents: "original",
  version: "v1",
} as const;

test("typing while saving keeps the newer text dirty and acknowledges the saved version", async () => {
  const buffer = createFileDocument(document, "first edit");
  const pending = Promise.withResolvers<WorkspaceFileSaveOutcome>();
  const saving = buffer.save({ write: () => pending.promise });
  await Promise.resolve();
  buffer.edit("second edit");
  pending.resolve({ kind: "saved", version: "v2" });
  await saving;
  expect(buffer.getSnapshot()).toMatchObject({
    contents: "second edit",
    savedContents: "first edit",
    version: "v2",
  });
});

test("an external refetch does not advance a dirty file's conflict baseline", async () => {
  const buffer = createFileDocument(document, "my edit");
  buffer.observeDisk({ ...document, contents: "external edit", version: "v2" });
  await buffer.save({
    write: async (input) => {
      expect(input.version).toBe("v1");
      return { kind: "conflict" };
    },
  });
  expect(buffer.getSnapshot()).toMatchObject({ contents: "my edit", status: { kind: "conflict" } });
});

test("formatting does not overwrite edits made while the formatter was running", async () => {
  const buffer = createFileDocument(document, "before format");
  const pending = Promise.withResolvers<WorkspaceFormatResult>();
  let writes = 0;
  const saving = buffer.save({
    format: () => pending.promise,
    write: async () => {
      writes += 1;
      return { kind: "saved", version: "v2" };
    },
  });
  buffer.edit("new typing");
  pending.resolve({
    kind: "formatted",
    contents: "formatted old text",
    version: "v1",
    formatter: "prettier",
  });
  await saving;
  expect(writes).toBe(0);
  expect(buffer.getSnapshot()).toMatchObject({
    contents: "new typing",
    savedContents: "original",
    status: { kind: "idle" },
  });
});

test("formatter failure keeps the draft and does not write unformatted text", async () => {
  const buffer = createFileDocument(document, "draft");
  let writes = 0;
  await buffer.save({
    format: async () => ({ kind: "unsupported", message: "No formatter" }),
    write: async () => {
      writes += 1;
      return { kind: "saved", version: "v2" };
    },
  });
  expect(writes).toBe(0);
  expect(buffer.getSnapshot()).toMatchObject({
    contents: "draft",
    status: { kind: "error", message: "No formatter" },
  });
});

test("failed writes retain formatted text and the old disk version for retry", async () => {
  const buffer = createFileDocument(document, "draft");
  await buffer.save({
    format: async () => ({
      kind: "formatted",
      contents: "formatted",
      version: "v1",
      formatter: "oxfmt",
    }),
    write: async () => {
      throw new Error("Read-only file");
    },
  });
  expect(buffer.getSnapshot()).toMatchObject({
    contents: "formatted",
    savedContents: "original",
    version: "v1",
    status: { kind: "error", message: "Read-only file" },
  });
  await buffer.save({
    write: async (input) => {
      expect(input.contents).toBe("formatted");
      return { kind: "saved", version: "v2" };
    },
  });
  expect(buffer.getSnapshot()).toMatchObject({
    contents: "formatted",
    savedContents: "formatted",
    version: "v2",
  });
});

test("discard adopts the latest disk text, while a clean refetch follows external changes", () => {
  const buffer = createFileDocument(document, "draft");
  buffer.discard({ ...document, contents: "latest", version: "v2" });
  expect(buffer.getSnapshot()).toMatchObject({
    contents: "latest",
    savedContents: "latest",
    version: "v2",
  });
  buffer.observeDisk({ ...document, contents: "later", version: "v3" });
  expect(buffer.getSnapshot().contents).toBe("later");
});
