import type { FolderTrust } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import { liveChoices } from "../../src/model/choices.ts";
import { buildView } from "../fixture/view.ts";
import { play, ready } from "./support.ts";

const view = buildView((v) =>
  v.turn("t1", (t) => t.user("first prompt").text("ok").ended("completed")),
);

describe("folder trust", () => {
  test.each<{
    readonly name: string;
    readonly trust: FolderTrust;
    readonly ask: "if-needed" | "always";
    readonly shows: "question" | "notice" | "nothing";
  }>([
    {
      name: "an undecided folder with project files asks",
      trust: { state: "undecided", notice: "ask", parent: "/dev" },
      ask: "if-needed",
      shows: "question",
    },
    {
      name: "an undecided folder with nothing to load stays quiet",
      trust: { state: "undecided", notice: null, parent: "/dev" },
      ask: "if-needed",
      shows: "nothing",
    },
    {
      name: "a folder the setting skips says its project files didn't load",
      trust: { state: "untrusted", by: { kind: "setting" }, notice: "tell", parent: "/dev" },
      ask: "if-needed",
      shows: "notice",
    },
    {
      name: "an untrusted folder with nothing to skip stays quiet",
      trust: {
        state: "untrusted",
        by: { kind: "folder", path: "/work" },
        notice: null,
        parent: "/dev",
      },
      ask: "if-needed",
      shows: "nothing",
    },
    {
      name: "a trusted folder stays quiet",
      trust: { state: "trusted", by: { kind: "folder", path: "/work" } },
      ask: "if-needed",
      shows: "nothing",
    },
    {
      name: "/trust on a trusted folder still opens the question",
      trust: { state: "trusted", by: { kind: "folder", path: "/work" } },
      ask: "always",
      shows: "question",
    },
    {
      name: "/trust in the home folder explains why it needs none",
      trust: { state: "home" },
      ask: "always",
      shows: "notice",
    },
  ])("$name", ({ trust, ask, shows }) => {
    const state = ready(view);
    const chat = state.facts.chat;
    if (chat === null || chat.kind === "blank") throw new Error("The fixture opened no chat.");
    const workspace = chat.info.workspace;

    const after = play(state, {
      kind: "trust-loaded",
      workspace,
      path: "/work",
      trust,
      sources: [".nyte/mcp.json"],
      ask,
    }).state;

    const question = after.local.dialogs.find(
      (dialog) => dialog.kind === "list" && dialog.purpose.kind === "trust",
    );

    expect(
      question !== undefined ? "question" : after.local.notice === null ? "nothing" : "notice",
    ).toBe(shows);

    if (question?.kind === "list") {
      const offered = (liveChoices(after, question.purpose) ?? []).map((entry) => entry.label);
      const parent = "parent" in trust ? trust.parent : null;

      expect(offered.includes(`Trust ${parent ?? ""}`)).toBe(parent !== null);
    }
  });
});
