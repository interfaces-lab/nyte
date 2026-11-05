import { isJsonObject } from "@nyte-ai/schema";
import type { RewriteStep } from "./migrations.ts";

/** A project became one coordinator chat with the settings its chats read: its lead is its coordinator, its brief its instructions, a goal their last line, and its worker its agents' model. */
export const projectCoordinators: RewriteStep = {
  kind: "rewrite",
  name: "2026-11-04-project-coordinators",
  rewrite(object) {
    if (!isJsonObject(object) || object.kind !== "project") return null;
    const body = object.body;

    if (!isJsonObject(body) || "models" in body) return null;
    const goal = isJsonObject(body.until) ? body.until.goal : undefined;

    const instructions = [
      typeof body.brief === "string" ? body.brief.trim() : "",
      typeof goal === "string" ? `Goal: ${goal}` : "",
    ].filter((line) => line !== "");

    return {
      ...object,
      body: {
        id: body.id ?? null,
        name: body.name ?? null,
        workspace: body.workspace ?? null,
        coordinator: body.lead ?? null,
        models: { coordinator: null, agents: body.worker ?? null },
        instructions: instructions.join("\n\n"),
        skills: [],
        disabledMcp: [],
        disabledDocs: [],
        archived: body.archived ?? false,
        createdAt: body.createdAt ?? 0,
      },
    };
  },
};
