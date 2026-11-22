import { expect, test } from "vitest";
import type { CommandInfo, Delivery } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { ImageContent } from "@nyte-ai/schema/model";
import type { MessageReference, ContentPart } from "../../references/message-references.ts";
import type { MessageFile } from "../transcript/message-content.tsx";
import type { ComposerSubmission } from "./composer-document.ts";
import { planEdit, planSubmission } from "./composer-plan.ts";
import type { DraftCommands, SubmissionPlan } from "./composer-plan.ts";

const compact: CommandInfo = {
  name: "compact",
  owner: "",
  side: "client",
  title: "Compact",
  description: "Summarize the chat to free up context",
  takesText: false,
  completes: false,
};

const LOADED: DraftCommands = { kind: "loaded", commands: [compact] };

const FAILED: DraftCommands = { kind: "failed", reason: "offline" };

const IMAGE: ImageContent = { type: "image", data: "AAAA", mimeType: "image/png" };

const FILE: MessageFile = {
  kind: "file",
  blob: asId<"blob">("b1"),
  mime: "text/plain",
  name: "notes.txt",
};

const SKILL: MessageReference = { kind: "skill", name: "review", path: "/skills/review/SKILL.md" };

const MENTION: MessageReference = {
  kind: "file",
  file: { kind: "file", path: "a.ts", url: "file:///a.ts", displayPath: "a.ts", label: "a.ts" },
};

const text = (value: string): ContentPart => ({ kind: "text", text: value });

const typed = (value: string): ComposerSubmission => ({
  text: value,
  references: [],
  parts: value === "" ? [] : [text(value)],
});

const message = (
  parts: readonly ContentPart[],
  delivery: Delivery = "steer",
  images: readonly ImageContent[] = [],
  files: readonly MessageFile[] = [],
): SubmissionPlan => ({ kind: "message", content: { parts, images, files }, delivery });

const BY_ITSELF: SubmissionPlan = { kind: "kept", message: "Send /compact by itself." };

const NOT_QUEUED: SubmissionPlan = {
  kind: "kept",
  message: "Commands can't run from a queued message.",
};

const UNLOADED: SubmissionPlan = { kind: "kept", message: "Commands couldn't load: offline" };

interface Row {
  readonly name: string;
  readonly edit?: { readonly files: readonly MessageFile[] };
  readonly submission: ComposerSubmission;
  readonly image?: true;
  readonly commands?: DraftCommands;
  readonly delivery?: Delivery;
  readonly plan: SubmissionPlan;
}

const ROWS: readonly Row[] = [
  { name: "nothing", submission: typed(""), plan: { kind: "empty" } },
  { name: "text", submission: typed("hello"), plan: message([text("hello")]) },
  {
    name: "text, queued",
    submission: typed("hello"),
    delivery: "queue",
    plan: message([text("hello")], "queue"),
  },
  {
    name: "an image alone",
    submission: typed(""),
    image: true,
    plan: message([], "steer", [IMAGE]),
  },
  {
    name: "a command",
    submission: typed("/compact"),
    plan: { kind: "command", command: { name: "compact", argument: "" }, delivery: "steer" },
  },
  {
    name: "a padded command with an argument",
    submission: typed("  /compact keep the plan  "),
    plan: {
      kind: "command",
      command: { name: "compact", argument: "keep the plan" },
      delivery: "steer",
    },
  },
  {
    name: "a command beside a file",
    submission: {
      text: "/compact @a.ts",
      references: [MENTION],
      parts: [text("/compact "), { kind: "reference", path: "a.ts" }],
    },
    plan: { kind: "command", command: { name: "compact", argument: "@a.ts" }, delivery: "steer" },
  },
  { name: "a command with an image", submission: typed("/compact"), image: true, plan: BY_ITSELF },
  {
    name: "a command beside a skill",
    submission: {
      text: "/compact [$review](/skills/review/SKILL.md)",
      references: [SKILL],
      parts: [text("/compact "), { kind: "skill", name: "review", location: SKILL.path }],
    },
    plan: BY_ITSELF,
  },
  {
    name: "an unknown command",
    submission: typed("/unknown x"),
    plan: message([text("/unknown x")]),
  },
  {
    name: "a command later in the text",
    submission: typed("please /compact"),
    plan: message([text("please /compact")]),
  },
  {
    name: "commands that failed to load",
    submission: typed("/compact"),
    commands: FAILED,
    plan: UNLOADED,
  },
  {
    name: "an edit keeps the message's files",
    edit: { files: [FILE] },
    submission: typed("updated"),
    plan: message([text("updated")], "steer", [], [FILE]),
  },
  {
    name: "an edit to a command",
    edit: { files: [] },
    submission: typed("/compact"),
    plan: NOT_QUEUED,
  },
  {
    name: "an edit to a command with an image",
    edit: { files: [] },
    submission: typed("/compact"),
    image: true,
    plan: NOT_QUEUED,
  },
  {
    name: "an edit to an unknown command",
    edit: { files: [] },
    submission: typed("/unknown x"),
    plan: message([text("/unknown x")]),
  },
  { name: "an emptied edit", edit: { files: [] }, submission: typed(""), plan: { kind: "empty" } },
  {
    name: "an emptied edit that keeps files",
    edit: { files: [FILE] },
    submission: typed(""),
    plan: { kind: "empty" },
  },
  {
    name: "an edit to an image alone",
    edit: { files: [] },
    submission: typed(""),
    image: true,
    plan: message([], "steer", [IMAGE]),
  },
  {
    name: "an edit while commands failed to load",
    edit: { files: [] },
    submission: typed("/compact"),
    commands: FAILED,
    plan: UNLOADED,
  },
];

test.each(ROWS)("$name", (row) => {
  const input = {
    submission: row.submission,
    attachments: row.image === true ? [{ content: IMAGE }] : [],
    commands: row.commands ?? LOADED,
    delivery: row.delivery ?? "steer",
  };

  expect(
    row.edit === undefined ? planSubmission(input) : planEdit({ ...input, files: row.edit.files }),
  ).toEqual(row.plan);
});
