import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

const UNAVAILABLE_REASON = Type.Enum(["unsupported", "unreachable"]);

export const AvailabilityType = Type.Union([
  Type.Object({ kind: Type.Literal("available") }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: UNAVAILABLE_REASON }),
]);

export type Availability = Decoded<typeof AvailabilityType>;

export const WorkspaceTargetType = Type.Union([
  Type.Object({ kind: Type.Literal("local"), path: Type.String() }),
  Type.Object({ kind: Type.String(), locator: JsonType }),
]);

export type WorkspaceTarget = Decoded<typeof WorkspaceTargetType>;

export const ActivationType = Type.Union([
  Type.Object({ kind: Type.Literal("active") }),
  Type.Object({ kind: Type.Literal("inactive") }),
  Type.Object({
    kind: Type.Literal("unavailable"),
    reason: UNAVAILABLE_REASON,
    workspace: idSchema<"workspace">(),
  }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

export type Activation = Decoded<typeof ActivationType>;

export const AddOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("added"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("exists"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("stale"), identity: idSchema<"environment-identity">() }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: UNAVAILABLE_REASON }),
]);

export type AddOutcome = Decoded<typeof AddOutcomeType>;

export const ForgetOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("forgotten") }),
  Type.Object({ kind: Type.Literal("busy"), sessions: Type.Array(idSchema<"session">()) }),
  Type.Object({ kind: Type.Literal("missing") }),
]);

export type ForgetOutcome = Decoded<typeof ForgetOutcomeType>;

export const WorktreeCleanupType = Type.Object({ cleaned: Type.Number() });

export type WorktreeCleanup = Decoded<typeof WorktreeCleanupType>;

export const STORAGE_GROUPS = ["worktrees", "projects", "caches", "nyte"] as const;

export type StorageGroup = (typeof STORAGE_GROUPS)[number];

export const DiskSpaceType = Type.Object({ size: Type.Number(), free: Type.Number() });

export type DiskSpace = Decoded<typeof DiskSpaceType>;

export const StorageItemType = Type.Object({
  /** Names the item to `workspaces.cleanStorage`. Stable between scans while the item stays the same. */
  id: Type.String(),
  group: Type.Enum(STORAGE_GROUPS),
  title: Type.String(),
  detail: Type.String(),
  path: nullable(Type.String()),
  /** Null when only the tool that owns it can tell, as for `pnpm store prune`. */
  bytes: nullable(Type.Number()),
  /** Why it can't be cleaned right now, such as "Xcode is open"; null when it can. */
  blocked: nullable(Type.String()),
});

export type StorageItem = Decoded<typeof StorageItemType>;

export const StorageScanType = Type.Object({
  disk: nullable(DiskSpaceType),
  items: Type.Array(StorageItemType),
});

export type StorageScan = Decoded<typeof StorageScanType>;

export const StorageCleanupType = Type.Object({
  cleaned: Type.Array(Type.String()),
  failed: Type.Array(Type.Object({ id: Type.String(), reason: Type.String() })),
  disk: nullable(DiskSpaceType),
});

export type StorageCleanup = Decoded<typeof StorageCleanupType>;

export const WorkspaceInspectionType = Type.Object({
  target: WorkspaceTargetType,
  identity: idSchema<"environment-identity">(),
  availability: AvailabilityType,
  projectSources: Type.Array(Type.String()),
  registered: nullable(idSchema<"workspace">()),
});

export type WorkspaceInspection = Decoded<typeof WorkspaceInspectionType>;

export const WorktreeIsolationType = Type.Object({
  kind: Type.Literal("worktree"),
  source: idSchema<"workspace">(),
  session: idSchema<"session">(),
  branch: Type.String(),
  base: Type.String(),
});

export type WorktreeIsolation = Decoded<typeof WorktreeIsolationType>;

export const WorkspaceInfoType = Type.Object({
  id: idSchema<"workspace">(),
  target: WorkspaceTargetType,
  identity: idSchema<"environment-identity">(),
  availability: AvailabilityType,
  projectResources: nullable(Type.Boolean()),
  trusted: nullable(Type.Boolean()),
  projectSources: Type.Array(Type.String()),
  addedBy: idSchema<"principal">(),
  writers: Type.Array(idSchema<"run">()),
  isolation: nullable(WorktreeIsolationType),
});

export type WorkspaceInfo = Decoded<typeof WorkspaceInfoType>;

export const AvailabilitySchema: Schema<Availability> = standard(AvailabilityType);

export const WorkspaceTargetSchema: Schema<WorkspaceTarget> = standard(
  withJson(WorkspaceTargetType),
);

export const ActivationSchema: Schema<Activation> = standard(ActivationType);

export const AddOutcomeSchema: Schema<AddOutcome> = standard(AddOutcomeType);

export const ForgetOutcomeSchema: Schema<ForgetOutcome> = standard(ForgetOutcomeType);

export const WorktreeCleanupSchema: Schema<WorktreeCleanup> = standard(WorktreeCleanupType);

export const StorageScanSchema: Schema<StorageScan> = standard(StorageScanType);

export const StorageCleanupSchema: Schema<StorageCleanup> = standard(StorageCleanupType);

export const WorkspaceInspectionSchema: Schema<WorkspaceInspection> = standard(
  withJson(WorkspaceInspectionType),
);

export const WorkspaceInfoSchema: Schema<WorkspaceInfo> = standard(withJson(WorkspaceInfoType));
