import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { ModelRefType } from "./models.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

/** The models a project's chats start on; null starts one on the host's default model. */
export const ProjectModelsType = Type.Object({
  coordinator: nullable(ModelRefType),
  agents: nullable(ModelRefType),
});

export const ProjectInfoType = Type.Object({
  id: idSchema<"project">(),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  workspace: idSchema<"workspace">(),
  coordinator: nullable(idSchema<"session">()),
  models: ProjectModelsType,
  instructions: Type.String(),
  skills: Type.Array(Type.String()),
  disabledMcp: Type.Array(Type.String()),
  disabledDocs: Type.Array(Type.String()),
  archived: Type.Boolean(),
  createdAt: Type.Number(),
});

/**
 * One coordinator chat in a folder and the settings every chat in it reads on each request.
 * `coordinator` is the chat, set when its first message starts it; its subagents are the
 * project's agents. `instructions` join their system prompt, the `skills` named there are read
 * into it, and the MCP servers in `disabledMcp` and the shared docs and context files in
 * `disabledDocs` (by `SharedDoc.id` and `ContextFile.id`) are left out of it. A session is in a project when its `project` names it.
 */
export type ProjectInfo = Decoded<typeof ProjectInfoType>;

export const PROJECT_EDITABLE = [
  "name",
  "models",
  "instructions",
  "skills",
  "disabledMcp",
  "disabledDocs",
  "archived",
] as const;

export const ProjectPatchType = Type.Partial(Type.Pick(ProjectInfoType, PROJECT_EDITABLE), {
  additionalProperties: false,
});

export type ProjectPatch = Decoded<typeof ProjectPatchType>;

export const ProjectInputType = Type.Pick(ProjectInfoType, [
  "name",
  "workspace",
  "models",
  "instructions",
  "skills",
  "disabledMcp",
  "disabledDocs",
]);

export type ProjectInput = Decoded<typeof ProjectInputType>;

export const ProjectInfoSchema: Schema<ProjectInfo> = standard(ProjectInfoType);

export const ProjectDraftInputType = Type.Object({
  goal: Type.String({ minLength: 1, pattern: "\\S" }),
  workspace: idSchema<"workspace">(),
  model: ModelRefType,
});

export type ProjectDraftInput = Decoded<typeof ProjectDraftInputType>;

export const ProjectDraftType = Type.Pick(ProjectInfoType, [
  "name",
  "instructions",
  "skills",
  "disabledMcp",
  "disabledDocs",
]);

/**
 * A setup drafted from a goal, for a person to check before `projects.create`. `skills` names only
 * skills the folder has; `disabledMcp` and `disabledDocs` name its MCP servers and shared docs the
 * goal doesn't need, never a context file.
 */
export type ProjectDraft = Decoded<typeof ProjectDraftType>;

export const ProjectDraftSchema: Schema<ProjectDraft> = standard(ProjectDraftType);

/**
 * A file in a `.nyte/projects/docs` folder, the home's (`user`) or the workspace's (`project`),
 * that a project's chats read and add to. `id` is `<scope>:<name>`, the same in every worktree.
 */
export const SharedDocType = Type.Object({
  id: Type.String(),
  name: Type.String(),
  scope: Type.Enum(["user", "project"]),
  location: Type.String(),
  description: Type.String(),
});

export type SharedDoc = Decoded<typeof SharedDocType>;

/**
 * A rules file a chat reads into its system prompt (`AGENTS.md`, `CLAUDE.md` and the like): the
 * home's (`user`), one above the folder (`ancestor`) or the folder's own (`project`). `id` is
 * `context:<scope>:<name>`, the same in every worktree, with the full `location` for an ancestor.
 */
export const ContextFileType = Type.Object({
  id: Type.String(),
  name: Type.String(),
  scope: Type.Enum(["user", "ancestor", "project"]),
  location: Type.String(),
});

export type ContextFile = Decoded<typeof ContextFileType>;
