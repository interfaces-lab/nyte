import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";

export const PageInfoType = Type.Object({
  id: idSchema<"page">(),
  url: Type.String(),
  title: Type.String(),
  holders: Type.Number(),
});

export type PageInfo = Decoded<typeof PageInfoType>;

export const PageViewType = Type.Object({
  id: idSchema<"page">(),
  url: Type.String(),
  title: Type.String(),
  loading: Type.Boolean(),
  revision: idSchema<"document-revision">(),
  canGoBack: Type.Boolean(),
  canGoForward: Type.Boolean(),
});

export type PageView = Decoded<typeof PageViewType>;

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

export type PageSnapshot = Decoded<typeof PageSnapshotType>;

export const ConsoleEntryType = Type.Object({
  level: Type.Enum(["log", "info", "warn", "error"]),
  text: Type.String(),
  at: Type.Number(),
});

export type ConsoleEntry = Decoded<typeof ConsoleEntryType>;

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

export type PageOutcome = Decoded<typeof PageOutcomeType>;

export const PageInfoSchema: Schema<PageInfo> = standard(PageInfoType);

export const PageViewSchema: Schema<PageView> = standard(PageViewType);

export const PageSnapshotSchema: Schema<PageSnapshot> = standard(PageSnapshotType);

export const ConsoleEntrySchema: Schema<ConsoleEntry> = standard(ConsoleEntryType);

export const PageOutcomeSchema: Schema<PageOutcome> = standard(PageOutcomeType);
