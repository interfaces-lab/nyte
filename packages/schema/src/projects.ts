import { Type } from "typebox";
import type { ProjectId, SessionId } from "./ids.ts";
import { idSchema } from "./ids.ts";
import { ModelRefType } from "./models.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

/** A project runs until its goal is met, or stands, taking work as it comes. */
export const ProjectUntilType = Type.Union([
  Type.Object({ kind: Type.Literal("standing") }),
  Type.Object({ kind: Type.Literal("goal"), goal: Type.String({ minLength: 1 }) }),
]);

export const ProjectInfoType = Type.Object({
  id: idSchema<"project">(),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  brief: Type.String(),
  until: ProjectUntilType,
  workspace: idSchema<"workspace">(),
  lead: nullable(idSchema<"session">()),
  worker: nullable(ModelRefType),
  archived: Type.Boolean(),
  createdAt: Type.Number(),
});

/**
 * A stream of work in one folder: one lead chat that keeps going, and the units it hands work to.
 * `brief` is the lead's system prompt: what the project is for and how its work is done. `lead`
 * is the chat that leads it, set when its first chat starts. `worker` is the model the lead starts
 * units on; null starts them on the lead's own. A session is in a project when its `project`
 * names it; every session in a project but the lead is one of its units.
 */
export type ProjectInfo = Decoded<typeof ProjectInfoType>;

/** The fields a person edits; `id`, `workspace`, `lead` and `createdAt` are the host's. */
export const PROJECT_EDITABLE = ["name", "brief", "until", "worker", "archived"] as const;

export const ProjectPatchType = Type.Partial(Type.Pick(ProjectInfoType, PROJECT_EDITABLE), {
  additionalProperties: false,
});

export type ProjectPatch = Decoded<typeof ProjectPatchType>;

const PROJECT = ProjectInfoType.properties;

export const ProjectInputType = Type.Object({
  name: PROJECT.name,
  brief: PROJECT.brief,
  until: PROJECT.until,
  workspace: PROJECT.workspace,
  worker: Type.Optional(PROJECT.worker),
});

export type ProjectInput = Decoded<typeof ProjectInputType>;

export const ProjectInfoSchema: Schema<ProjectInfo> = standard(ProjectInfoType);

/** How a session takes part in its project: the lead, or one of its units. */
export type ProjectRole = "lead" | "unit";

export function projectRole(project: Pick<ProjectInfo, "lead">, session: SessionId): ProjectRole {
  return project.lead === session ? "lead" : "unit";
}

/** The projects by id, for a pass that joins sessions to theirs. */
export function indexProjects(
  projects: readonly ProjectInfo[],
): ReadonlyMap<ProjectId, ProjectInfo> {
  return new Map(projects.map((project) => [project.id, project]));
}

/**
 * The system prompt section a session in `project` reads, framed for its role, then the brief. Core
 * sends it with every request; a client shows it to preview what the lead reads.
 */
export function projectPrompt(project: ProjectInfo, role: ProjectRole): string {
  return `${FRAMING[role](project)}\n\n${brief(project)}`;
}

const FRAMING = {
  lead: (project) =>
    [
      `You lead the project “${project.name}”. ${until(project)} This chat keeps going and holds the project's state. You triage, brief, review and decide; units do the work.`,
      [
        "Units",
        `- A unit is one change with one owner, in a chat of its own the user can open and talk to. Start it with create, a title naming the change, and isolation "worktree" when it edits files. ${worker(project)}`,
        "- Its brief is self-contained, since it sees none of this chat: the goal, the evidence (path:line, repro steps), the constraints, the skills to read first, and the done check.",
        "- Follow up with send and collect with await. Every finished reply reaches you as a report, including replies to the user when they talk to a unit directly. When the user moves a chat into the project, a message tells you: take it on as a unit.",
        "- Do yourself what is shorter than briefing it: triage, questions, reviews. Don't split small work across units.",
      ].join("\n"),
      [
        "Lifecycle",
        "queued → writing → proving → review → committed → pull request → done. A unit moves forward only on evidence: the failing check before, the same check passing after, and the diff you reviewed. Without it, send the unit back with path:line findings.",
      ].join("\n"),
      "Ask the user before merging, pushing to a branch the project didn't open, deleting work, or anything the brief doesn't cover. Decide everything else.",
      "End every reply with the board, one row per unit:\n| Unit | State | Evidence | Next |",
    ].join("\n\n"),
  unit: (project) =>
    [
      `You work one unit of the project “${project.name}”, led by its lead chat. ${until(project)} Do the change in your first message and nothing else. The user can open this chat and talk to you: answer them, within your unit.`,
      "Every reply you finish reaches the lead. End it with:\nState: writing, proving, blocked or done\nChanged: the files\nEvidence: each command or check you ran and its result\nNot verified: what you couldn't check",
      "Blocked on a decision you can't make: say what it is and stop.",
    ].join("\n\n"),
} satisfies { readonly [R in ProjectRole]: (project: ProjectInfo) => string };

function until(project: ProjectInfo): string {
  return project.until.kind === "goal"
    ? `Its goal: ${project.until.goal}.`
    : "It is standing: it takes work as it comes.";
}

function worker(project: ProjectInfo): string {
  return project.worker === null
    ? "Units run on your model unless you name another."
    : `Start every unit on the model ${project.worker.provider}/${project.worker.id} unless the user asks otherwise.`;
}

function brief(project: ProjectInfo): string {
  return project.brief.trim() === ""
    ? "The project has no brief yet. Ask the user what it is for and how its work should be done."
    : `The project's brief:\n\n${project.brief.trim()}`;
}
