import { Type } from "typebox";
import { ConfigurationPatchType, ConfigurationType } from "./configuration.ts";
import { ValidationIssueType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, PositionType, UserContentType } from "./messages.ts";
import { ModelRefType } from "./models.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

const ABANDONED = Type.Union([
  Type.Literal("keep"),
  Type.Object({ summarize: Type.Object({ instructions: Type.Optional(Type.String()) }) }),
]);

export const TreeNodeType = Type.Object({
  id: idSchema<"commit">(),
  parent: nullable(idSchema<"commit">()),
  depth: Type.Number(),
  branch: Type.Boolean(),
  active: Type.Boolean(),
  heads: Type.Array(idSchema<"head">()),
  kind: Type.Enum(["user", "part", "compaction", "branchSummary"]),
  partKind: nullable(Type.String()),
  preview: Type.String(),
  at: Type.Number(),
  run: nullable(idSchema<"run">()),
});

export type TreeNode = Decoded<typeof TreeNodeType>;

export const TreeViewType = Type.Object({
  revision: nullable(idSchema<"revision">()),
  tip: PositionType,
  nodes: Type.Array(TreeNodeType),
});

export type TreeView = Decoded<typeof TreeViewType>;

export const CreateHeadOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("created"), basedOn: PositionType }),
  Type.Object({ kind: Type.Literal("exists") }),
  Type.Object({ kind: Type.Literal("missing-source") }),
]);

export type CreateHeadOutcome = Decoded<typeof CreateHeadOutcomeType>;

export const MergeOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("merged"), revision: idSchema<"revision">() }),
  Type.Object({ kind: Type.Literal("stale"), revision: idSchema<"revision">() }),
  Type.Object({ kind: Type.Literal("diverged"), base: PositionType }),
  Type.Object({ kind: Type.Literal("is-main") }),
  Type.Object({ kind: Type.Literal("busy"), run: idSchema<"run">() }),
]);

export type MergeOutcome = Decoded<typeof MergeOutcomeType>;

export const RemoveHeadOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("removed") }),
  Type.Object({ kind: Type.Literal("missing") }),
  Type.Object({ kind: Type.Literal("is-main") }),
  Type.Object({ kind: Type.Literal("busy"), run: idSchema<"run">() }),
]);

export type RemoveHeadOutcome = Decoded<typeof RemoveHeadOutcomeType>;

export const MoveOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("moved"),
    revision: idSchema<"revision">(),
    position: PositionType,
    summary: nullable(idSchema<"message">()),
    handback: nullable(UserContentType),
  }),
  Type.Object({ kind: Type.Literal("stale"), revision: idSchema<"revision">() }),
  Type.Object({ kind: Type.Literal("busy"), run: idSchema<"run">() }),
  Type.Object({ kind: Type.Literal("pending-input"), messages: Type.Array(idSchema<"message">()) }),
  Type.Object({ kind: Type.Literal("missing-target") }),
  Type.Object({ kind: Type.Literal("summary-failed"), reason: Type.String() }),
]);

export type MoveOutcome = Decoded<typeof MoveOutcomeType>;

export const MoveOptionsType = Type.Object({
  running: Type.Optional(Type.Enum(["refuse", "stop"])),
  abandoned: Type.Optional(ABANDONED),
  expect: Type.Optional(idSchema<"revision">()),
});

export type MoveOptions = Decoded<typeof MoveOptionsType>;

export const SendOptionsType = Type.Object({
  delivery: Type.Optional(DeliveryType),
  replace: Type.Optional(idSchema<"message">()),
  running: Type.Optional(Type.Enum(["refuse", "stop"])),
  abandoned: Type.Optional(ABANDONED),
  expect: Type.Optional(idSchema<"revision">()),
  position: Type.Optional(
    Type.Union([
      Type.Object({ kind: Type.Literal("last") }),
      Type.Object({ kind: Type.Literal("before"), message: idSchema<"message">() }),
    ]),
  ),
  source: Type.Optional(MessageSourceType),
  configuration: Type.Optional(Type.Union([ConfigurationType, ConfigurationPatchType])),
  id: Type.Optional(idSchema<"receipt">()),
});

export type SendOptions = Decoded<typeof SendOptionsType>;

export const ConfigureOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("configured"),
    selected: ConfigurationType,
    revision: idSchema<"revision">(),
  }),
  Type.Object({ kind: Type.Literal("unknown-model"), model: ModelRefType }),
  Type.Object({ kind: Type.Literal("unknown-agent"), agent: Type.String() }),
  Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
]);

export type ConfigureOutcome = Decoded<typeof ConfigureOutcomeType>;

export const TreeNodeSchema: Schema<TreeNode> = standard(TreeNodeType);

export const TreeViewSchema: Schema<TreeView> = standard(TreeViewType);

export const CreateHeadOutcomeSchema: Schema<CreateHeadOutcome> = standard(CreateHeadOutcomeType);

export const MergeOutcomeSchema: Schema<MergeOutcome> = standard(MergeOutcomeType);

export const RemoveHeadOutcomeSchema: Schema<RemoveHeadOutcome> = standard(RemoveHeadOutcomeType);

export const MoveOutcomeSchema: Schema<MoveOutcome> = standard(MoveOutcomeType);

export const MoveOptionsSchema: Schema<MoveOptions> = standard(MoveOptionsType);

export const SendOptionsSchema: Schema<SendOptions> = standard(withJson(SendOptionsType));

export const ConfigureOutcomeSchema: Schema<ConfigureOutcome> = standard(
  withJson(ConfigureOutcomeType),
);
