import { Type } from "typebox";
import type { ConsoleEntry, PageInfo, PageOutcome, PageSnapshot, PageView } from "../browser.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";

/** The TypeBox schema of a `PageInfo`. */
export const PageInfoType = Type.Object({
  id: idSchema<"page">(),
  url: Type.String(),
  title: Type.String(),
  holders: Type.Number(),
});

/** The TypeBox schema of a `PageView`. */
export const PageViewType = Type.Object({
  id: idSchema<"page">(),
  url: Type.String(),
  title: Type.String(),
  loading: Type.Boolean(),
  revision: idSchema<"document-revision">(),
  canGoBack: Type.Boolean(),
  canGoForward: Type.Boolean(),
});

/** The TypeBox schema of a `PageSnapshot`. */
export const PageSnapshotType = Type.Object({
  revision: idSchema<"document-revision">(),
  nodes: Type.Array(
    Type.Object({
      ref: Type.String(),
      role: Type.String(),
      name: Type.String(),
      editable: Type.Boolean(),
      depth: Type.Number(),
    }),
  ),
});

/** The TypeBox schema of a `ConsoleEntry`. */
export const ConsoleEntryType = Type.Object({
  level: Type.Enum(["log", "info", "warn", "error"]),
  text: Type.String(),
  at: Type.Number(),
});

/** The TypeBox schema of a `PageOutcome`. */
export const PageOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("applied"), snapshot: PageSnapshotType }),
  Type.Object({ kind: Type.Literal("stale"), revision: idSchema<"document-revision">() }),
  Type.Object({
    kind: Type.Literal("refused"),
    reason: Type.Enum(["unknown-ref", "occluded", "not-visible", "policy"]),
  }),
  Type.Object({
    kind: Type.Literal("closed"),
    reason: Type.Enum(["released", "reclaimed", "crashed"]),
  }),
]);

/** Validates a `PageInfo`. */
export const PageInfoSchema: Schema<PageInfo> = standard(PageInfoType);

/** Validates a `PageView`. */
export const PageViewSchema: Schema<PageView> = standard(PageViewType);

/** Validates a `PageSnapshot`. */
export const PageSnapshotSchema: Schema<PageSnapshot> = standard(PageSnapshotType);

/** Validates a `ConsoleEntry`. */
export const ConsoleEntrySchema: Schema<ConsoleEntry> = standard(ConsoleEntryType);

/** Validates a `PageOutcome`. */
export const PageOutcomeSchema: Schema<PageOutcome> = standard(PageOutcomeType);
