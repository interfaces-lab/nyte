import type { Agent, Command } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "./core.ts";

/**
 * The reviewer's whole system prompt: it replaces every section, byte for
 * byte, so a cached reviewer role stays cached.
 *
 * @category plugins
 * @since 0.1.0
 */
export const REVIEW_PROMPT = `You review code changes. Read the changed files and the code around them before judging.
Report, most severe first: bugs, missing cases, broken contracts, unclear names, and needless code.
For each finding give the file and line, what is wrong, and the smallest fix. Say plainly when you find nothing.
Do not edit files.`;

const reviewer: Agent = {
  id: "reviewer",
  description: "Reviews the working changes and reports findings without editing.",
  mode: "all",
  prompt: { kind: "replace", text: REVIEW_PROMPT },
  tools: ["read", "list"],
};

const review: Command<{ readonly focus?: string }> = {
  name: "review",
  title: "Review changes",
  description: "Ask the reviewer agent to review the working changes.",
  arguments: standard(Type.Object({ focus: Type.Optional(Type.String({ description: "What to look at most closely." })) })),
  category: "agents",
  async run(args, { api }) {
    if (api.side !== "core") return "Review runs on the host.";
    const focus = args.focus?.trim() ?? "";
    const changed = (await api.session.view()).changes.map((change) => `- ${change.path} (${change.status})`);

    const receipt = await api.session.send(
      [
        `Review the working changes${focus === "" ? "" : `, focusing on ${focus}`}.`,
        changed.length === 0 ? "This session changed no files; review what the user points you to." : `Files this session changed:\n${changed.join("\n")}`,
      ].join("\n"),
      { configuration: { agent: reviewer.id }, source: { kind: "action", label: "Review changes", command: "review" }, delivery: "queue" },
    );

    return `The reviewer is on it (${receipt.id}).`;
  },
};

/**
 * Adds the `reviewer` agent, whose prompt replaces the system prompt and
 * whose tools only read (`read`, `list`: no shell, no write-class tool,
 * §48h), and the `review` command that sends a review request under that
 * agent, naming the files the session changed.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "reviewer",
  contribute: { agents: [reviewer], commands: [review] },
} satisfies Plugin;
