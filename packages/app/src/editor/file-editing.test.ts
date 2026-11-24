import { expect, test } from "vitest";
import { readLineEndings, resolveIndentation } from "./file-editing.ts";

test.each([
  {
    name: "LF, 2 spaces",
    contents: "if (a) {\n  b();\n  if (c) {\n    d();\n  }\n}\n",
    endings: "LF",
    indentation: { kind: "spaces", size: 2 },
    source: "detected",
  },
  {
    name: "CRLF, 4 spaces",
    contents: "if (a) {\r\n    b();\r\n    if (c) {\r\n        d();\r\n    }\r\n}\r\n",
    endings: "CRLF",
    indentation: { kind: "spaces", size: 4 },
    source: "detected",
  },
  {
    name: "CR, 8 spaces",
    contents: "if (a) {\r        b();\r        if (c) {\r                d();\r        }\r}\r",
    endings: "CR",
    indentation: { kind: "spaces", size: 8 },
    source: "detected",
  },
  {
    name: "mixed endings",
    contents: "a {\r\n  b\n  c {\r\n    d\n",
    endings: "Mixed",
    indentation: { kind: "spaces", size: 2 },
    source: "detected",
  },
  {
    name: "empty file",
    contents: "",
    endings: "None",
    indentation: { kind: "spaces", size: 2 },
    source: "default",
  },
  {
    name: "one line without a newline",
    contents: "plain",
    endings: "None",
    indentation: { kind: "spaces", size: 2 },
    source: "default",
  },
  {
    name: "BOM right before a tab",
    contents: "\uFEFF\tone\r\ntwo\r\n",
    endings: "CRLF",
    indentation: { kind: "tabs", size: 2 },
    source: "detected",
  },
  {
    name: "tab-indented with doc comments",
    contents: "/**\n * Docs.\n */\nfunction a() {\n\tif (b) {\n\t\tc();\n\t}\n}\n",
    endings: "LF",
    indentation: { kind: "tabs", size: 2 },
    source: "detected",
  },
  {
    name: "tabs and spaces in one file",
    contents: "a {\n\tb\n}\nc {\n    d\n}\n",
    endings: "LF",
    indentation: { kind: "spaces", size: 2 },
    source: "default",
  },
  {
    name: "a tie between 2 and 4",
    contents: "a\n  b\nc\n    d\n",
    endings: "LF",
    indentation: { kind: "spaces", size: 2 },
    source: "default",
  },
  {
    name: "no indented lines",
    contents: "one\ntwo\n\nthree\n",
    endings: "LF",
    indentation: { kind: "spaces", size: 2 },
    source: "default",
  },
  {
    name: "only 3-space steps",
    contents: "a\n   b\n      c\n",
    endings: "LF",
    indentation: { kind: "spaces", size: 2 },
    source: "default",
  },
])("$name: $endings, $source $indentation.kind $indentation.size", (row) => {
  expect(readLineEndings(row.contents)).toBe(row.endings);
  expect(resolveIndentation(undefined, row.contents)).toEqual({
    indentation: row.indentation,
    source: row.source,
  });
});
