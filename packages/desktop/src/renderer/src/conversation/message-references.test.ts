import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { composerMessageContent, composerPromptText } from "./composer-send.ts";
import {
  CONVERSATION_MENTION,
  draftPreviewText,
  fileFromUrl,
  messageDraftText,
  messageParts,
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
