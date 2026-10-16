import { asId } from "@nyte-ai/schema";
import { SLASH_COMMANDS } from "../../src/lib/slash.ts";
import type { CompletionModel } from "../../src/model/completion.ts";
import type { Dialog } from "../../src/model/dialogs/dialog.ts";
import { draftModel, NO_PARTS } from "../../src/model/draft.ts";
import type { DraftParts } from "../../src/model/draft.ts";
import type { TableInput } from "../../src/model/table-input.ts";
import type { Place, QueueRow } from "../../src/model/queue.ts";
import type { Blocked, RunModel } from "../../src/model/table-input.ts";
import type { Draft } from "../../src/model/state.ts";

export interface TableSpec {
  readonly run?: "idle" | "working" | "waiting" | "retrying";
  readonly draft?: string;
  readonly attachment?: boolean;
  readonly question?: "head" | "child";
  readonly editing?: "steer" | "queue";
  readonly shell?: boolean;
  readonly completion?: "slash" | "skill" | "cd" | "empty";
  readonly blocked?: "starting" | "switching" | "authenticating";
  readonly dialog?: boolean;
  readonly followUp?: "steer" | "queue";
  readonly queue?: readonly {
    readonly id: string;
    readonly place: "joining" | "next-turn" | "sending" | "uncovered";
  }[];
  readonly tasks?: number;
  readonly row?: Draft["row"];
  readonly cursor?: "start" | "end";
  readonly browsing?: boolean;
}

function runOf(spec: TableSpec["run"]): RunModel {
  switch (spec ?? "idle") {
    case "working":
      return { kind: "working", run: asId("r1"), stopping: false };
    case "waiting":
      return { kind: "waiting", run: asId("r1") };
    case "retrying":
      return { kind: "retrying", run: asId("r1"), until: 5_000, reason: "rate limited" };
    default:
      return { kind: "idle" };
  }
}

function placeOf(place: "joining" | "next-turn" | "sending" | "uncovered"): Place {
  switch (place) {
    case "joining":
      return { kind: "joining", run: asId("r1") };
    case "next-turn":
      return { kind: "next-turn", reason: "run-ended" };
    case "sending":
      return { kind: "sending", retryAt: null, reason: null };
    default:
      return { kind: "uncovered" };
  }
}

function blockedOf(spec: TableSpec["blocked"]): Blocked | null {
  if (spec === undefined) return null;

  return spec === "authenticating" ? { kind: "authenticating", link: null } : { kind: spec };
}

function completionOf(spec: TableSpec["completion"]): CompletionModel | null {
  if (spec === undefined) return null;

  if (spec === "empty")
    return {
      token: { trigger: "/", query: "zz", from: 0, to: 3 },
      items: [],
      loading: false,
      highlighted: 0,
      ownsEnter: false,
      queueable: false,
    };

  if (spec === "cd")
    return {
      token: { trigger: "cd", query: "sr", from: 4, to: 6 },
      items: [{ id: "src/", label: "src/", detail: "", kind: "directory" }],
      loading: false,
      highlighted: 0,
      ownsEnter: false,
      queueable: false,
    };

  return {
    token: { trigger: "/", query: "re", from: 0, to: 3 },
    items: [
      spec === "skill"
        ? { id: "review", label: "/review", detail: "Review code", kind: "skill" }
        : { id: "resume", label: "/resume", detail: "Resume a chat", kind: "action" },
    ],
    loading: false,
    highlighted: 0,
    ownsEnter: true,
    queueable: spec === "skill",
  };
}

const PALETTE: Dialog = {
  kind: "list",
  id: "dialog-1",
  purpose: { kind: "palette" },
  title: "Commands",
  choices: { kind: "ready", items: [] },
  query: "",
  highlighted: 0,
  answering: null,
  busy: false,
};

export function tableInput(spec: TableSpec): TableInput {
  const marker = "[File a.ts]";
  const text = spec.attachment === true ? `${spec.draft ?? ""} ${marker}` : (spec.draft ?? "");

  const parts: DraftParts =
    spec.attachment === true
      ? new Map([[marker, { kind: "file", path: "/w/a.ts", directory: false }]])
      : NO_PARTS;

  const cursor = spec.cursor === "start" ? 0 : text.length;
  const draft: Draft = { text, cursor, row: spec.row ?? "only", parts };

  const queue: QueueRow[] = (spec.queue ?? []).map((row) => ({
    id: asId(row.id),
    text: row.id,
    place: placeOf(row.place),
    delivery: "steer",
    withdrawable: row.place !== "sending",
    editable: true,
    editing: false,
  }));

  const typed = draftModel(draft);

  return {
    run: runOf(spec.run),
    question:
      spec.question === undefined
        ? null
        : {
            session: asId(spec.question === "head" ? "s1" : "s9"),
            part: asId("q1"),
            questions: [
              {
                question: "Pick one",
                header: "Pick",
                options: [
                  { label: "A", description: "" },
                  { label: "B", description: "" },
                ],
              },
            ],
            field: {
              question: "Pick one",
              header: "Pick",
              options: [
                { label: "A", description: "" },
                { label: "B", description: "" },
              ],
            },
            index: 0,
            owner: spec.question === "head" ? { kind: "head" } : { kind: "child", short: "s9" },
            panel: false,
          },
    draft: typed,
    runsCommand:
      typed.kind === "message" && SLASH_COMMANDS.some((command) => command.name === typed.command),
    editing:
      spec.editing === undefined
        ? null
        : { message: "m1", delivery: spec.editing, stillPending: true },
    shell:
      spec.shell === true
        ? {
            id: "shell-1",
            session: null,
            command: "sleep 9",
            include: true,
            startedAt: 1_000,
            output: "",
            state: { kind: "running" },
            delivered: false,
          }
        : null,
    completion: completionOf(spec.completion),
    dialog: spec.dialog === true ? PALETTE : null,
    blocked: blockedOf(spec.blocked),
    queue,
    followUp: spec.followUp ?? "steer",
    tasks: spec.tasks ?? 0,
    now: 0,
    cursor: { row: draft.row, atStart: cursor === 0, atEnd: cursor === text.length },
    browsing: spec.browsing ?? false,
  };
}
