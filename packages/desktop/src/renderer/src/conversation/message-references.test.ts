import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { composerMessageContent, composerPromptText } from "./composer-send.ts";
import {
  CONVERSATION_MENTION,
  clipboardReferenceFromPaste,
  draftPreviewText,
  fileFromUrl,
  inlineCodeReference,
  messageDraftText,
  messageParts,
  referencePromptText,
  referenceText,
  skillInstruction,
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

  test("a sent message reads its head sentences back as chips and keeps its body exact", () => {
    const text = `${skillInstruction("review")}\n\n${skillInstruction("audit")}\n\nfix @file:///p/a.ts please`;
    const parts = messageParts(text, { form: "message" });
    assert.deepEqual(
      parts.map((part) => (part.kind === "text" ? part.text : part.reference)),
      [
        { kind: "skill", name: "review", path: "" },
        { kind: "skill", name: "audit", path: "" },
        "fix ",
        { kind: "file", file: fileFromUrl("file:///p/a.ts") },
        " please",
      ],
    );
    assert.equal(
      parts.map((part) => (part.kind === "text" ? part.text : part.source)).join(""),
      text,
    );
    // A sentence in the body is prose, not a chip.
    const body = messageParts(`Hello.\n\n${skillInstruction("review")}`, { form: "message" });
    assert.deepEqual(body, [{ kind: "text", text: `Hello.\n\n${skillInstruction("review")}` }]);
  });

  test("editing a sent message round-trips exactly through the draft and back", () => {
    const sent = `${skillInstruction("review")}\n\nfix @file:///p/a.ts`;
    const draft = messageDraftText(sent);
    assert.equal(draft, "[$review]() fix @file:///p/a.ts");
    const parts = messageParts(draft, { form: "draft" });
    const references = parts.flatMap((part) => (part.kind === "reference" ? [part.reference] : []));
    const submissionText = parts
      .map((part) =>
        part.kind === "text" ? part.text : part.reference.kind === "file" ? part.source : "",
      )
      .join("");
    assert.equal(composerPromptText(submissionText.trim(), references), sent);
  });

  test("the message content prepends one instruction per distinct chip and carries images after", () => {
    const references: MessageReference[] = [skill, skill, CONVERSATION_MENTION];
    assert.equal(
      composerPromptText("fix it", references),
      `${skillInstruction("review")}\n\nfix it`,
    );
    const image = { content: { type: "image" as const, data: "AA==", mimeType: "image/png" } };
    assert.deepEqual(composerMessageContent("", [image], []), [image.content]);
    assert.deepEqual(composerMessageContent("hi", [image], [skill]), [
      { type: "text", text: `${skillInstruction("review")}\n\nhi` },
      image.content,
    ]);
    assert.equal(referenceText(skill), "[$review](/skills/review/SKILL.md)");
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

describe("clipboard chips", () => {
  const body = "one\ntwo\nthree\nfour";

  test("a paste becomes a chip at four lines or 512 characters, never for a URL", () => {
    assert.equal(clipboardReferenceFromPaste("one\ntwo\nthree"), undefined);
    assert.deepEqual(clipboardReferenceFromPaste(body), { kind: "clipboard", body });
    assert.equal(clipboardReferenceFromPaste("x".repeat(511)), undefined);
    assert.deepEqual(clipboardReferenceFromPaste("x".repeat(512)), {
      kind: "clipboard",
      body: "x".repeat(512),
    });
    assert.equal(clipboardReferenceFromPaste("https://example.com/a/b"), undefined);
    assert.equal(clipboardReferenceFromPaste("http://example.com/a/b"), undefined);
    assert.equal(
      clipboardReferenceFromPaste(`https://example.com/${"a".repeat(500)}`),
      undefined,
    );
    assert.equal(clipboardReferenceFromPaste("www.example.com"), undefined);
    assert.equal(clipboardReferenceFromPaste(""), undefined);
  });

  test("a restored clipboard token is a chip and a long draft without one is not", () => {
    const pasted = clipboardReferenceFromPaste(body);
    assert.deepEqual(pasted, { kind: "clipboard", body });
    if (pasted === undefined) return;
    const draft = `see ${referenceText(pasted)} please`;
    const parts = messageParts(draft, { form: "draft", complete: true });
    assert.equal(parts[1]?.kind, "reference");
    if (parts[1]?.kind !== "reference") return;
    assert.equal(parts[1].reference.kind, "clipboard");
    if (parts[1].reference.kind !== "clipboard") return;
    assert.equal(parts[1].reference.body, body);
    assert.equal(referencePromptText(pasted), body);
    assert.equal(draftPreviewText(draft), "see Clipboard (4 lines) please");
    const longLine = clipboardReferenceFromPaste("x".repeat(512));
    assert.deepEqual(longLine, { kind: "clipboard", body: "x".repeat(512) });
    if (longLine === undefined) return;
    assert.equal(draftPreviewText(referenceText(longLine)), "Clipboard (1 line)");

    const long = `${"line\n".repeat(20)}plain`;
    assert.equal(
      messageParts(long, { form: "draft", complete: true }).every((part) => part.kind === "text"),
      true,
    );
  });

  test("a clipboard token round-trips quotes, backslashes, and newlines", () => {
    const special = `"quoted"\nC:\\temp\nthird\nfourth`;
    const pasted = clipboardReferenceFromPaste(special);
    assert.deepEqual(pasted, { kind: "clipboard", body: special });
    if (pasted === undefined) return;
    const token = referenceText(pasted);
    assert.equal(token.includes("\n"), false);
    const parts = messageParts(`x ${token} y`, { form: "draft", complete: true });
    assert.equal(parts[1]?.kind, "reference");
    if (parts[1]?.kind !== "reference") return;
    assert.equal(parts[1].reference.kind, "clipboard");
    if (parts[1].reference.kind !== "clipboard") return;
    assert.equal(parts[1].reference.body, special);
    assert.equal(
      messageParts(token, { form: "draft", complete: false })[0]?.kind,
      "reference",
    );
  });

  test("a token-shaped string in a sent message stays text", () => {
    const pasted = clipboardReferenceFromPaste(body);
    assert.deepEqual(pasted, { kind: "clipboard", body });
    if (pasted === undefined) return;
    const token = referenceText(pasted);
    assert.deepEqual(messageParts(token, { form: "message" }), [{ kind: "text", text: token }]);
    assert.deepEqual(messageParts("@clipboard/2:{}", { form: "draft", complete: true }), [
      { kind: "text", text: "@clipboard/2:{}" },
    ]);
    assert.deepEqual(messageParts("@clipboard/2:\"\"", { form: "draft", complete: true }), [
      { kind: "text", text: "@clipboard/2:\"\"" },
    ]);
    assert.deepEqual(messageParts("@clipboard/12:\"short\"", { form: "draft", complete: true }), [
      { kind: "text", text: "@clipboard/12:\"short\"" },
    ]);
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
