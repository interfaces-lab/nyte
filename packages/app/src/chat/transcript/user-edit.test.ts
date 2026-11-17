import { expect, test } from "vitest";
import type { UserContent } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { DesktopModelOption } from "../../data/catalog.ts";
import { beginEdit, decideSave, dismissible, nextEdit } from "./user-edit.ts";
import type { UserEditEvent, UserEditState } from "./user-edit.ts";
import type { BranchModelPicker } from "./turn-view.tsx";

function model(key: string): DesktopModelOption {
  return {
    key,
    provider: "test",
    id: key,
    name: key,
    contextWindow: 1_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    thinkingLevels: ["off", "high"],
    defaultThinking: "off",
    info: {
      ref: { provider: "test", id: key },
      name: key,
      reasoning: true,
      thinking: ["off", "high"],
      defaultThinking: "off",
      variants: [],
      contextWindow: 1_000,
      compactAt: 900,
      maxOutput: 100,
      input: ["text"],
      capabilities: { steer: true },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    input: ["text"],
    capabilities: { steer: true },
    listing: "shown",
    listed: true,
  };
}

const file = {
  kind: "file",
  blob: asId<"blob">("b1"),
  mime: "text/plain",
  name: "notes.txt",
} as const;

const content: UserContent = [{ kind: "text", text: "Fix the build." }, file];

const branch: BranchModelPicker = {
  catalog: undefined,
  model: model("sonnet"),
  thinkingLevel: "off",
  modes: [],
};

const image = {
  id: "i1",
  name: "shot.png",
  content: { type: "image", data: "", mimeType: "image/png" },
} as const;

const opened = beginEdit(content, branch);

const draft = (text: string) => ({
  parts: text === "" ? [] : [{ kind: "text", text } as const],
  images: [],
  files: [],
});

test("an edit opens on the message's text with the caret at its end, its files kept and the branch's model", () => {
  expect(opened).toMatchObject({
    document: { text: "Fix the build.", selectionStart: 14, selectionEnd: 14 },
    kept: [file],
    model: branch.model,
    thinkingLevel: "off",
    modes: [],
    saving: false,
  });
});

test.each<[string, readonly UserEditEvent[], boolean]>([
  ["an untouched edit closes on a click outside", [], true],
  [
    "a changed text keeps it open",
    [{ kind: "document", document: { text: "Fix it.", selectionStart: 0, selectionEnd: 0 } }],
    false,
  ],
  [
    "the same text with the caret moved closes",
    [
      {
        kind: "document",
        document: { text: "Fix the build.", selectionStart: 0, selectionEnd: 3 },
      },
    ],
    true,
  ],
  [
    "an added image keeps it open",
    [{ kind: "attached", attachments: [image], error: undefined }],
    false,
  ],
  [
    "an image removed again closes",
    [
      { kind: "attached", attachments: [image], error: undefined },
      { kind: "removed-attachment", id: "i1" },
    ],
    true,
  ],
  ["a removed file keeps it open", [{ kind: "removed-kept", file }], false],
  ["an image still being read keeps it open", [{ kind: "reading", delta: 1 }], false],
  [
    "the read finishing closes",
    [
      { kind: "reading", delta: 1 },
      { kind: "reading", delta: -1 },
    ],
    true,
  ],
  [
    "another model keeps it open",
    [{ kind: "model", change: { option: model("opus"), thinkingLevel: "off", modes: [] } }],
    false,
  ],
  [
    "another thinking level keeps it open",
    [{ kind: "model", change: { option: model("sonnet"), thinkingLevel: "high", modes: [] } }],
    false,
  ],
  [
    "fast mode keeps it open",
    [{ kind: "model", change: { option: model("sonnet"), thinkingLevel: "off", modes: ["fast"] } }],
    false,
  ],
  ["a failed save with nothing changed closes", [{ kind: "failed", error: "Offline." }], true],
])("%s", (_name, events, closes) => {
  expect(dismissible(events.reduce(nextEdit, opened), content, branch)).toBe(closes);
});

test("a save underway keeps the edit open and ignores another save", () => {
  const saving: UserEditState = { ...opened, saving: true };

  expect([dismissible(saving, content, branch), decideSave(saving, draft("Again")).kind]).toEqual([
    false,
    "busy",
  ]);
});

test("an empty message says so and stays open; a message sends with the edit's model and clears the error", () => {
  const empty = decideSave(opened, draft(""));

  const picked = nextEdit(opened, {
    kind: "model",
    change: { option: model("opus"), thinkingLevel: "high", modes: ["fast"] },
  });

  const sent = decideSave({ ...picked, error: "A message cannot be empty." }, draft("Fix it."));

  expect(empty).toEqual({
    kind: "empty",
    edit: { ...opened, error: "A message cannot be empty." },
  });
  expect(sent).toEqual({
    kind: "send",
    edit: { ...picked, saving: true, error: undefined },
    choice: { model: model("opus"), thinkingLevel: "high", modes: ["fast"] },
  });
  expect(
    nextEdit(
      { ...opened, error: "A message cannot be empty." },
      {
        kind: "document",
        document: { text: "F", selectionStart: 1, selectionEnd: 1 },
      },
    ).error,
  ).toBeUndefined();
});
