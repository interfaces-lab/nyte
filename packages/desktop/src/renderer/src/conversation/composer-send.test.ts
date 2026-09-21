import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { CommandInfo } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import { deliveryChoices, submissionDelivery } from "./composer-keys.ts";
import { composerSendInput, composerSendPlan } from "./composer-send.ts";
import { CONVERSATION_MENTION } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

const SESSION = sessionId("session-1");
const roles = deliveryChoices;
const rename: CommandInfo = { name: "rename", description: "Rename the chat", owner: "rename" };
const skill: MessageReference = { kind: "skill", name: "review", path: "/skills/review/SKILL.md" };
const image = { content: { type: "image" as const, data: "AA==", mimeType: "image/png" } };

describe("composer send", () => {
  test("Enter sends to the next idle head and the modifier steers the live run", () => {
    const submission = { text: "hello", references: [] };
    const next = composerSendPlan({
      submission,
      attachments: [],
      commands: [],
      delivery: submissionDelivery("submit", roles),
    });
    const steer = composerSendPlan({
      submission,
      attachments: [],
      commands: [],
      delivery: submissionDelivery("submit-alternate", roles),
    });
    assert.deepEqual(next, { kind: "message", content: "hello", delivery: "next" });
    assert.deepEqual(steer, { kind: "message", content: "hello", delivery: "steer" });
    assert.equal(next.kind, "message");
    assert.deepEqual(composerSendInput(SESSION, next), {
      sessionId: SESSION,
      content: "hello",
      delivery: "next",
    });
  });

  test("a first message for a new chat carries its delivery the same way", () => {
    const plan = composerSendPlan({
      submission: { text: "start here", references: [] },
      attachments: [image],
      commands: [],
      delivery: submissionDelivery("submit-alternate", roles),
    });
    assert.deepEqual(plan, {
      kind: "message",
      content: [{ type: "text", text: "start here" }, image.content],
      delivery: "steer",
    });
  });

  test("nothing to send is refused before any delivery is chosen", () => {
    assert.deepEqual(
      composerSendPlan({
        submission: { text: "   ", references: [CONVERSATION_MENTION] },
        attachments: [],
        commands: [],
        delivery: roles.steer,
      }),
      { kind: "empty" },
    );
    assert.equal(
      composerSendPlan({
        submission: { text: "", references: [skill] },
        attachments: [],
        commands: [],
        delivery: roles.steer,
      }).kind,
      "message",
    );
  });

  test("a plugin command's line runs the command in the chosen delivery; a chip or image makes it a message", () => {
    assert.deepEqual(
      composerSendPlan({
        submission: { text: "/rename Fresh start", references: [] },
        attachments: [],
        commands: [rename],
        delivery: roles.queue,
      }),
      { kind: "command", command: { name: "rename", argument: "Fresh start" }, delivery: "next" },
    );
    assert.equal(
      composerSendPlan({
        submission: { text: "/rename x", references: [] },
        attachments: [image],
        commands: [rename],
        delivery: roles.steer,
      }).kind,
      "message",
    );
    assert.equal(
      composerSendPlan({
        submission: { text: "/rename x", references: [skill] },
        attachments: [],
        commands: [rename],
        delivery: roles.steer,
      }).kind,
      "message",
    );
  });
});
