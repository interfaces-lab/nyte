import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown-parse.ts";
import { markdownExtensions } from "./markdown-schema.ts";
import { markdownOrigin, serializeMarkdown } from "./markdown-serialize.ts";

const sweep = process.env.NYTE_MARKDOWN_CORPUS === "repository";

const root = sweep
  ? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
  : fileURLToPath(new URL("markdown-corpus", import.meta.url));

const files = sweep
  ? execFileSync("git", ["ls-files", "-z", "*.md", "*.markdown"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter((path) => path !== "")
  : readdirSync(root);

const schema = getSchema(markdownExtensions);

function serialize(content: JSONContent, text: string): string {
  const parsed = parseMarkdown(text);
  const doc = schema.nodeFromJSON(content);

  return serializeMarkdown(doc, markdownOrigin(doc, parsed.layout));
}

function detached(content: JSONContent): JSONContent {
  const attrs = Object.fromEntries(
    Object.entries(content.attrs ?? {}).filter(
      ([name]) => name !== "origin" && name !== "inlineOrigin",
    ),
  );

  return { ...content, attrs, content: content.content?.map(detached) };
}

describe("markdown round trip", () => {
  it.each(files)("%s comes back byte for byte", (path) => {
    const text = readFileSync(join(root, path), "utf8");

    expect(serialize(parseMarkdown(text).content, text)).toBe(text);
  });

  it.each(files)("%s rewritten from scratch reads back the same", (path) => {
    const text = readFileSync(join(root, path), "utf8");
    const content = detached(parseMarkdown(text).content);
    const rewritten = serialize(content, text);

    expect(detached(parseMarkdown(rewritten).content)).toEqual(content);
  });
});
