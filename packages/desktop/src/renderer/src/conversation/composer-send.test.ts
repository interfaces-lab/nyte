import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { CommandInfo } from "@nyte-ai/core";
import { DEFAULT_LANDING, sessionId } from "@nyte-ai/protocol";
import { laneRoles, submissionLane } from "./composer-keys.ts";
import { composerSendInput, composerSendPlan } from "./composer-send.ts";
import { CONVERSATION_MENTION } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

const SESSION = sessionId("session-1");
const roles = laneRoles(DEFAULT_LANDING);
const rename: CommandInfo = { name: "rename", description: "Rename the chat", owner: "rename" };
const skill: MessageReference = { kind: "skill", name: "review", path: "/skills/review/SKILL.md" };
const image = { content: { type: "image" as const, data: "AA==", mimeType: "image/png" } };

describe("composer send", () => {
  test("Enter sends a message to the boundary lane and the modifier to the idle lane", () => {
    const submission = { text: "hello", references: [] };
    const now = composerSendPlan({
      submission,
      attachments: [],
      commands: [],
      lane: submissionLane("submit", roles),
    });
    const later = composerSendPlan({
      submission,
      attachments: [],
      commands: [],
      lane: submissionLane("submit-alternate", roles),
    });
    assert.deepEqual(now, { kind: "message", content: "hello", lane: "steer" });
    assert.deepEqual(later, { kind: "message", content: "hello", lane: "queue" });
    assert.equal(now.kind, "message");
    assert.deepEqual(composerSendInput(SESSION, now), {
      sessionId: SESSION,
      content: "hello",
      lane: "steer",
    });
  });

  test("a first message for a new chat carries its lane the same way", () => {
    const plan = composerSendPlan({
      submission: { text: "start here", references: [] },
      attachments: [image],
      commands: [],
      lane: submissionLane("submit-alternate", roles),
    });
    assert.deepEqual(plan, {
      kind: "message",
      content: [{ type: "text", text: "start here" }, image.content],
      lane: "queue",
    });
  });

  test("nothing to send is refused before any lane is chosen", () => {
    assert.deepEqual(
      composerSendPlan({
        submission: { text: "   ", references: [CONVERSATION_MENTION] },
        attachments: [],
        commands: [],
        lane: roles.steer,
      }),
      { kind: "empty" },
    );
    assert.equal(
      composerSendPlan({
        submission: { text: "", references: [skill] },
        attachments: [],
        commands: [],
        lane: roles.steer,
      }).kind,
      "message",
    );
  });

  test("a plugin command's line runs the command in the chosen lane; a chip or image makes it a message", () => {
    assert.deepEqual(
      composerSendPlan({
        submission: { text: "/rename Fresh start", references: [] },
        attachments: [],
        commands: [rename],
        lane: roles.queue,
      }),
      { kind: "command", command: { name: "rename", argument: "Fresh start" }, lane: "queue" },
    );
    assert.equal(
      composerSendPlan({
        submission: { text: "/rename x", references: [] },
        attachments: [image],
        commands: [rename],
        lane: roles.steer,
      }).kind,
      "message",
    );
    assert.equal(
      composerSendPlan({
        submission: { text: "/rename x", references: [skill] },
        attachments: [],
        commands: [rename],
        lane: roles.steer,
      }).kind,
      "message",
    );
  });
});
