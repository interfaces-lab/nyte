import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  CONVERSATION_MENTION,
  clipboardReferenceFromPaste,
  draftPreviewText,
  fileFromUrl,
  inlineCodeReference,
  messageParts,
  referenceLabel,
  referenceText,
} from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

const skill: MessageReference = { kind: "skill", name: "review", path: "/skills/review/SKILL.md" };

describe("message references", () => {
  test("a file URL describes its file without a catalog, and a bad one stays text", () => {
    assert.deepEqual(fileFromUrl("file:///project/a%20file.ts"), {
      path: "/project/a file.ts",
      url: "file:///project/a%20file.ts",
      displayPath: "/project/a file.ts",
      label: "a file.ts",
    });
    assert.equal(fileFromUrl("file:///project/src/")?.label, "src/");
    assert.equal(fileFromUrl("http://example.com"), undefined);
    assert.equal(fileFromUrl("file:///%E0%A4%A"), undefined);
  });

  test("a draft yields its chips back from their tokens", () => {
    const text = `Compare @file:///p/a.ts with [$review](/skills/review/SKILL.md) @current-conversation`;
    const parts = messageParts(text, { form: "draft" });
    assert.deepEqual(
      parts.map((part) => (part.kind === "text" ? part.text : part.reference.kind)),
      ["Compare ", "file", " with ", "skill", " ", "mention"],
    );
    assert.equal(
      parts.map((part) => (part.kind === "text" ? part.text : part.source)).join(""),
      text,
    );
    const references = parts.flatMap((part) => (part.kind === "reference" ? [part.reference] : []));
    assert.deepEqual(references[1], skill);
    assert.deepEqual(references[2], CONVERSATION_MENTION);
  });

  test("a token being typed at the end waits for its delimiter unless the text is complete", () => {
    const typing = { form: "draft", complete: false } as const;
    assert.deepEqual(messageParts("see @file:///p/a.ts", typing), [
      { kind: "text", text: "see @file:///p/a.ts" },
    ]);
    assert.equal(messageParts("see @file:///p/a.ts ", typing)[1]?.kind, "reference");
    assert.equal(messageParts("see @file:///p/a.ts", { form: "draft" })[1]?.kind, "reference");
    // A skill link closes itself.
    assert.equal(messageParts("[$review](/s)", typing)[0]?.kind, "reference");
  });

  test("a slash word is prose, not a chip", () => {
    assert.deepEqual(messageParts("/review now", { form: "draft" }), [
      { kind: "text", text: "/review now" },
    ]);
  });
});

test("sidebar draft previews preserve visible skills without exposing token syntax", () => {
  assert.equal(
    draftPreviewText("[$review](/skills/review/SKILL.md) Fix this\nMore detail"),
    "/review Fix this",
  );
  assert.equal(draftPreviewText("[$review](/skills/review/SKILL.md)"), "/review");
  assert.equal(draftPreviewText("/rev"), "/rev");
  assert.equal(draftPreviewText("@file:///project/example.ts Fix this"), "example.ts Fix this");
  assert.equal(draftPreviewText("  \n  "), "Draft");
});

describe("clipboard paste classification", () => {
  test.each([
    { rule: "empty text stays inline", text: "" },
    { rule: "ordinary sentences stay inline", text: "word ".repeat(200) },
    { rule: "line count alone does not create a chip", text: "line\n".repeat(100) },
    { rule: "10,000 characters stay inline", text: "x".repeat(10_000) },
    { rule: "CRLF is normalized before measuring", text: "a\r\n".repeat(4_000) },
    { rule: "trailing newlines are removed before measuring", text: `${"x".repeat(10_000)}\n\n` },
  ])("$rule", ({ text }) => {
    assert.equal(clipboardReferenceFromPaste(text), undefined);
  });

  test.each([
    { rule: "10,001 characters become a chip", body: "x".repeat(10_001) },
    { rule: "long URLs have no exemption", body: `https://example.com/${"a".repeat(10_000)}` },
    { rule: "length counts UTF-16 code units", body: "😀".repeat(5_001) },
  ])("$rule", ({ body }) => {
    assert.deepEqual(clipboardReferenceFromPaste(body), { kind: "clipboard", body });
  });
});

describe("clipboard paste normalization", () => {
  const text = "x".repeat(10_001);

  test.each([
    { rule: "CRLF becomes LF", input: `${text}\r\nsecond`, body: `${text}\nsecond` },
    { rule: "all trailing newlines are removed", input: `${text}\n\n`, body: text },
    { rule: "leading newlines are preserved", input: `\n${text}`, body: `\n${text}` },
    { rule: "spaces and tabs are preserved", input: ` \t${text}\t `, body: ` \t${text}\t ` },
    { rule: "lone carriage returns are preserved", input: `${text}\r`, body: `${text}\r` },
  ])("$rule", ({ input, body }) => {
    assert.deepEqual(clipboardReferenceFromPaste(input), { kind: "clipboard", body });
  });
});

describe("clipboard chips", () => {
  const clipboard = { kind: "clipboard", body: "one\ntwo\nthree\nfour" } as const;

  test.each([
    { body: "word", label: "Clipboard (1 line)" },
    { body: "one\n\nthree", label: "Clipboard (3 lines)" },
  ])("labels $label", ({ body, label }) => {
    assert.equal(referenceLabel({ kind: "clipboard", body }), label);
  });

  test("restores a clipboard token between plain text", () => {
    const token = referenceText(clipboard);
    assert.deepEqual(messageParts(`see ${token} please`, { form: "draft" }), [
      { kind: "text", text: "see " },
      { kind: "reference", reference: clipboard, source: token },
      { kind: "text", text: " please" },
    ]);
  });

  test("a complete clipboard token needs no following delimiter", () => {
    const token = referenceText(clipboard);
    assert.deepEqual(messageParts(token, { form: "draft", complete: false }), [
      { kind: "reference", reference: clipboard, source: token },
    ]);
  });

  test("a long draft without a clipboard token stays text", () => {
    const text = "line\n".repeat(3_000);
    assert.deepEqual(messageParts(text, { form: "draft" }), [{ kind: "text", text }]);
  });

  test("the draft preview shows the label instead of the token", () => {
    assert.equal(
      draftPreviewText(`see ${referenceText(clipboard)} please`),
      "see Clipboard (4 lines) please",
    );
  });

  test.each([
    { rule: "quotes", body: '"quoted"' },
    { rule: "backslashes", body: "C:\\temp" },
    { rule: "newlines", body: "one\ntwo" },
  ])("round-trips $rule through a token", ({ body }) => {
    const reference = { kind: "clipboard", body } as const;
    const token = referenceText(reference);
    assert.deepEqual(messageParts(token, { form: "draft" }), [
      { kind: "reference", reference, source: token },
    ]);
  });

  test("a multiline body encodes into a single-line token", () => {
    assert.equal(referenceText(clipboard).includes("\n"), false);
  });

  test("a clipboard token in a sent message stays literal", () => {
    const text = referenceText(clipboard);
    assert.deepEqual(messageParts(text, { form: "message" }), [{ kind: "text", text }]);
  });

  test.each([
    { rule: "non-string payload", text: "@clipboard/2:{}" },
    { rule: "empty body", text: '@clipboard/2:""' },
    { rule: "truncated payload", text: '@clipboard/12:"short"' },
  ])("leaves a $rule as plain text", ({ text }) => {
    assert.deepEqual(messageParts(text, { form: "draft" }), [{ kind: "text", text }]);
  });
});

describe("inlineCodeReference", () => {
  const file = (displayPath: string) => ({
    path: `/project/${displayPath}`,
    url: `file:///project/${displayPath}`,
    displayPath,
    label: displayPath.split("/").at(-1) ?? displayPath,
  });
  const mockups = file("packages/ui/src/mockups.tsx");
  const readme = file("README.md");
  const files = [
    mockups,
    readme,
    file("packages/ui/src/index.ts"),
    file("packages/core/src/index.ts"),
  ];

  test("links a workspace path, a root file, and a unique basename", () => {
    assert.deepEqual(inlineCodeReference("packages/ui/src/mockups.tsx", files), {
      kind: "file",
      file: mockups,
    });
    assert.deepEqual(inlineCodeReference("./packages/ui/src/mockups.tsx", files), {
      kind: "file",
      file: mockups,
    });
    assert.deepEqual(inlineCodeReference("mockups.tsx", files), { kind: "file", file: mockups });
    assert.deepEqual(inlineCodeReference("README.md", files), { kind: "file", file: readme });
  });

  test("leaves anything that is not one real file literal", () => {
    // Two files answer to this basename, so a link would pick the wrong one.
    assert.equal(inlineCodeReference("index.ts", files), undefined);
    assert.equal(inlineCodeReference("packages/ui/src/**", files), undefined);
    assert.equal(inlineCodeReference("text-ui-*", files), undefined);
    assert.equal(inlineCodeReference("pnpm fmt:classes", files), undefined);
    assert.equal(inlineCodeReference("packages/ui/src/missing.ts", files), undefined);
    assert.equal(inlineCodeReference("Title$", files), undefined);
    assert.equal(inlineCodeReference("   ", files), undefined);
  });

  test("re-indexes when the file list changes", () => {
    assert.equal(inlineCodeReference("added.ts", files), undefined);
    const added = file("packages/ui/src/added.ts");
    assert.deepEqual(inlineCodeReference("added.ts", [...files, added]), {
      kind: "file",
      file: added,
    });
  });
});
