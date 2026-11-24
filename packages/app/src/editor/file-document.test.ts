import { expect, test } from "vitest";
import type { FileDocument, WriteOutcome } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { createFileDocument } from "./file-document.ts";

const v1 = asId<"file-version">("v1");

const v2 = asId<"file-version">("v2");

const document: Extract<FileDocument, { readonly kind: "text" }> = {
  kind: "text",
  path: "/workspace/file.ts",
  scope: "workspace",
  mime: "text/plain",
  contents: "original",
  encoding: "utf8",
  version: v1,
};

test("typing while saving keeps the newer text dirty and acknowledges the saved version", async () => {
  const buffer = createFileDocument(document, "first edit");
  const pending = Promise.withResolvers<WriteOutcome>();
  const saving = buffer.save({ write: () => pending.promise });
  await Promise.resolve();
  buffer.edit("second edit");
  pending.resolve({ kind: "saved", version: v2 });
  await saving;
  expect({ ...buffer.getSnapshot(), contents: buffer.text() }).toMatchObject({
    contents: "second edit",
    savedContents: "first edit",
    version: "v2",
  });
});

test("an external refetch does not advance a dirty file's conflict baseline", async () => {
  const buffer = createFileDocument(document, "my edit");
  buffer.observeDisk({ ...document, contents: "external edit", version: v2 });
  await buffer.save({
    write: async (input) => {
      expect(input.version).toBe("v1");

      return { kind: "stale", current: v2 };
    },
  });
  expect({ ...buffer.getSnapshot(), contents: buffer.text() }).toMatchObject({
    contents: "my edit",
    status: { kind: "conflict" },
  });
});

test("formatter failure still saves the unformatted draft", async () => {
  const buffer = createFileDocument(document, "draft");
  const written: string[] = [];
  await buffer.save({
    format: async () => {
      throw new Error("No formatter");
    },
    write: async (input) => {
      written.push(input.contents);

      return { kind: "saved", version: v2 };
    },
  });
  expect(written).toEqual(["draft"]);
  expect({ ...buffer.getSnapshot(), contents: buffer.text() }).toMatchObject({
    contents: "draft",
    savedContents: "draft",
    status: { kind: "saved" },
    formatFailure: "No formatter",
  });
});

test("failed writes retain formatted text and the old disk version for retry", async () => {
  const buffer = createFileDocument(document, "draft");
  await buffer.save({
    format: async () => {
      buffer.edit("formatted");

      return null;
    },
    write: async () => {
      throw new Error("Read-only file");
    },
  });
  expect({ ...buffer.getSnapshot(), contents: buffer.text() }).toMatchObject({
    contents: "formatted",
    savedContents: "original",
    version: "v1",
    status: { kind: "error", message: "Read-only file" },
  });
  await buffer.save({
    write: async (input) => {
      expect(input.contents).toBe("formatted");

      return { kind: "saved", version: v2 };
    },
  });
  expect({ ...buffer.getSnapshot(), contents: buffer.text() }).toMatchObject({
    contents: "formatted",
    savedContents: "formatted",
    version: "v2",
  });
});

test("discard adopts the latest disk text, while a clean refetch follows external changes", () => {
  const buffer = createFileDocument(document, "draft");
  buffer.discard({ ...document, contents: "latest", version: v2 });
  expect({ ...buffer.getSnapshot(), contents: buffer.text() }).toMatchObject({
    contents: "latest",
    savedContents: "latest",
    version: "v2",
  });
  buffer.observeDisk({ ...document, contents: "later", version: asId<"file-version">("v3") });
  expect(buffer.text()).toBe("later");
});
