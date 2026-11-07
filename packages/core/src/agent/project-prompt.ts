import type { Kernel } from "../contract/kernel.ts";
import type { PromptSection } from "../contract/plugin.ts";
import { decodeProjectRecord } from "../contract/records.ts";
import type { ProjectRecord, SessionRecord } from "../contract/records.ts";
import type { Resources } from "../contract/workspace.ts";
import { readText, SHARED_DOCS } from "../extend/resources.ts";
import { projectRef } from "../store/refs.ts";
import { load } from "../store/session.ts";

/** Before the context files (order 10 is theirs), so a folder's own rules still have the last word. */
const ORDER = 5;

/**
 * The system prompt section a session in a project reads: its role, the project's instructions,
 * its shared docs and its preloaded skills. The project is read on every request, so an edit
 * reaches the next one. A session in none, or in a project since removed, reads none.
 */
export async function projectSections(
  kernel: Kernel,
  record: SessionRecord,
  resources: Resources,
): Promise<readonly PromptSection[]> {
  if (record.project === undefined) return [];

  const found = await load(
    kernel.store,
    await kernel.store.refs.get(projectRef(record.project)),
    decodeProjectRecord,
  );

  if (found === null) return [];
  const project = found.record;
  const skills = await preloadedSkills(project, resources);

  const text = [
    project.coordinator === record.id ? coordinating(project) : working(project),
    ...(project.instructions.trim() === ""
      ? []
      : [`The user's instructions for this project:\n\n${project.instructions.trim()}`]),
    sharedContext(project, resources, kernel.home),
    ...(skills === "" ? [] : [skills]),
  ].join("\n\n");

  return [{ id: "project", order: ORDER, text }];
}

function coordinating(project: ProjectRecord): string {
  return [
    `You coordinate the project “${project.name}”. The user talks to you in this chat. You plan the work, hand it to agents, check what they report, and tell the user where things stand.`,
    [
      "Agents",
      "- An agent is a subagent you start with create: a full chat the user can open and talk to, working in this folder. Start one per independent piece of work and let them run in parallel. Agents that run at once change separate files.",
      "- Brief each agent as if it has seen nothing of this chat: the goal, the evidence (path:line, how to reproduce), the constraints, the shared docs and skills that apply, and how to check it is done.",
      "- Follow up with send and collect with await. Do the work yourself when it is shorter than a brief.",
      "- An agent that reports the same failure twice has stopped making progress. Don't send it back a third time: tell the user what was tried and ask how to go on.",
    ].join("\n"),
    [
      "Mentioning agents",
      "- Link an agent by the id create returned: [short title](agent:<id>). The chat draws the link with the agent's live status and opens its chat on click, so don't write its state beside it.",
      "- Report on agents as a list of those links, each followed by one line on what changed or what it needs from the user. Don't put agents in a table.",
    ].join("\n"),
  ].join("\n\n");
}

function working(project: ProjectRecord): string {
  return [
    `You are an agent in the project “${project.name}”, started by its coordinator. Do the task in your first message. The user can open this chat and talk to you; answer them within your task.`,
    "- Two failed attempts at the same thing, such as the same check, CI job or error, is the limit. Stop and report what you tried, the output and your best guess at the cause. Don't try a third time.",
    "- End your reply with what you changed, each check you ran and its result, and what you couldn't verify.",
  ].join("\n");
}

function sharedContext(project: ProjectRecord, resources: Resources, home: string | null): string {
  const folders = [
    ...(resources.project === null ? [] : [`${SHARED_DOCS} for this folder`]),
    ...(home === null || resources.user === null
      ? []
      : [`${home}/${SHARED_DOCS} for every folder`]),
  ];

  const docs = resources.docs.filter((doc) => !project.disabledDocs.includes(doc.id));

  return [
    `Shared context: what earlier chats learned, kept as files in ${folders.join(" and ")}. Read the ones that bear on your task before you start.`,
    ...(docs.length === 0
      ? ["- None yet."]
      : docs.map((doc) =>
          doc.description === "" ? `- ${doc.location}` : `- ${doc.location}: ${doc.description}`,
        )),
    "When you learn something a later chat would need, such as how to test a service, how a part is wired, research, a canvas's source or how the user wants work done, write it there: one topic per Markdown file with a `description` in its frontmatter. Update a file instead of adding a near-duplicate. What holds for this codebase goes in this folder's docs, the user's preferences in the home's.",
  ].join("\n");
}

/** The files of the skills the project preloads, read from the folder each was found in. */
async function preloadedSkills(project: ProjectRecord, resources: Resources): Promise<string> {
  const read = await Promise.all(
    resources.skills
      .filter((skill) => project.skills.includes(skill.name))
      .map(async (skill) => {
        const files = skill.scope === "project" ? resources.project : resources.user;
        const content = files === null ? null : await readText(files, skill.location);

        return content === null ? [] : [`# ${skill.name} (${skill.location})\n\n${content.trim()}`];
      }),
  );

  const skills = read.flat();

  return skills.length === 0 ? "" : ["Skills preloaded for this project:", ...skills].join("\n\n");
}
