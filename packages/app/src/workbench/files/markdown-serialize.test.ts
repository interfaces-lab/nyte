import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { expect, test } from "vitest";
import type { FileDocument } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { createFileDocument } from "./file-document.ts";
import { parseMarkdown } from "./markdown-parse.ts";
import { markdownExtensions } from "./markdown-schema.ts";
import { markdownOrigin, serializeMarkdown } from "./markdown-serialize.ts";

const schema = getSchema(markdownExtensions);

const source = [
  "| Column | Value |",
  "| ------ | ----: |",
  "| alpha  |     1 |",
  "| beta   |     2 |",
  "",
].join("\n");

const document: Extract<FileDocument, { readonly kind: "text" }> = {
  kind: "text",
  path: "/workspace/table.md",
  scope: "workspace",
  mime: "text/markdown",
  contents: source,
  version: asId<"file-version">("v1"),
};

test.each([
  ["stays within its column", "x", "| alpha  |    1x |"],
  ["grows past its column", " and a much longer value", "| alpha  | 1 and a much longer value |"],
])("an edited aligned table cell that %s is saved", async (_, typed, row) => {
  const parsed = parseMarkdown(source);
  const doc = schema.nodeFromJSON(parsed.content);
  const origin = markdownOrigin(doc, parsed.layout);
  let end = -1;

  doc.descendants((node, position) => {
    if (node.type.name === "tableCell" && node.textContent === "1")
      end = position + node.nodeSize - 1;
  });
  const edited = EditorState.create({ doc }).tr.insertText(typed, end).doc;

  const buffer = createFileDocument(document);
  buffer.edit(serializeMarkdown(edited, origin));
  const saved: string[] = [];

  await buffer.save({
    write: async (input) => {
      saved.push(input.contents);

      return { kind: "saved", version: asId<"file-version">("v2") };
    },
  });

  expect(saved).toEqual([source.replace("| alpha  |     1 |", row)]);
  const cells: string[] = [];

  schema.nodeFromJSON(parseMarkdown(saved[0] ?? "").content).descendants((node) => {
    if (node.type.name === "tableCell") cells.push(node.textContent);
  });
  expect(cells).toEqual(["alpha", `1${typed}`, "beta", "2"]);
});
