import { typed } from "@nyte-ai/schema/model";
import { Type } from "typebox";

export const GROUPINGS = [
  "inbox",
  "none",
  "repository",
  "updated",
  "status",
  "environment",
] as const;

export const SORTS = ["created", "updated", "status"] as const;

export const SHELVES = ["inbox", "working", "done", "archived"] as const;

export const SHOW_FIELDS = ["updated"] as const;

export const STATUSES = ["needs-attention", "unread", "working", "draft", "done"] as const;

export const ENVIRONMENTS = ["cloud", "local"] as const;

export type SessionGrouping = (typeof GROUPINGS)[number];

export type SessionSort = (typeof SORTS)[number];

export type SessionShowField = (typeof SHOW_FIELDS)[number];

export type SessionStatus = (typeof STATUSES)[number];

export type SessionEnvironment = (typeof ENVIRONMENTS)[number];

export type SessionShelf = (typeof SHELVES)[number];

export interface SessionViewSettings {
  readonly grouping: SessionGrouping;
  readonly sort: SessionSort;
  readonly show: readonly SessionShowField[];
  readonly statuses: readonly SessionStatus[];
  readonly environments: readonly SessionEnvironment[];
  readonly archived: boolean;
}

export const SessionViewSchema = typed<SessionViewSettings>()(
  Type.Object({
    grouping: Type.Enum(GROUPINGS),
    sort: Type.Enum(SORTS),
    show: Type.Immutable(Type.Array(Type.Enum(SHOW_FIELDS))),
    statuses: Type.Immutable(Type.Array(Type.Enum(STATUSES))),
    environments: Type.Immutable(Type.Array(Type.Enum(ENVIRONMENTS))),
    archived: Type.Boolean(),
  }),
);

export const DEFAULT_SESSION_VIEW: SessionViewSettings = Object.freeze({
  grouping: "none",
  sort: "created",
  show: ["updated"] as const,
  statuses: [],
  environments: [],
  archived: false,
});
