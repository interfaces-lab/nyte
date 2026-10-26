import type { Agent, Kind, PullRequest, Session, Stack } from "./model.ts";

/** Nyte itself polls CI; no model runs until something fails. */
export const WATCHER = "Nyte";

/**
 * The lead's first pick for a task, read from what each agent says it does. It is only a
 * suggestion: the composer shows it and you can swap, add or drop anyone before sending.
 */
export function propose(stack: Stack, kind: Kind): readonly string[] {
  const checkers = stack.agents.filter((agent) => /check|review|screenshot|test/i.test(agent.does));

  if (kind === "review") return checkers.map((agent) => agent.id);

  if (kind === "babysit") {
    const fixer =
      stack.agents.find((agent) => /lint|format|\bci\b|fail/i.test(agent.does)) ?? stack.agents[0];

    return fixer === undefined ? [] : [fixer.id];
  }

  const writer =
    stack.agents.find(
      (agent) => /writ|fix|build|make/i.test(agent.does) && !/lint|format/i.test(agent.does),
    ) ?? stack.agents[0];

  if (writer === undefined) return [];

  return [
    writer.id,
    ...checkers.filter((agent) => agent.id !== writer.id).map((agent) => agent.id),
  ];
}

/** Agents named with @ in the text, in the order you wrote them. */
export function mentioned(stack: Stack, text: string): readonly string[] {
  const names = [...text.matchAll(/@([\w-]+)/g)].map((match) => match[1]?.toLowerCase());

  return names.flatMap((name) =>
    stack.agents.filter((agent) => agent.name.toLowerCase() === name).map((agent) => agent.id),
  );
}

/** The agents behind `ids`, in order, skipping any that left the stack. */
export function hands(stack: Stack, ids: readonly string[]): readonly Agent[] {
  return ids.flatMap((id) => stack.agents.filter((agent) => agent.id === id));
}

/** The lead as an agent, for the steps it takes itself. */
export function leadAgent(stack: Stack): Agent {
  return {
    id: "lead",
    name: stack.name,
    model: stack.lead,
    does: "Plans each task, reviews it and opens the pull request",
    skills: stack.skills,
  };
}

export function sessionFor(agent: Agent, state: string, turns: number, lead = false): Session {
  return {
    name: agent.name,
    model: agent.model,
    does: agent.does,
    lead,
    state,
    turns,
    cost: turns * 0.03,
  };
}

/** What happens to a task, said once in the activity when the lead takes it. */
export function planSentence(
  stack: Stack,
  kind: Kind,
  staff: readonly Agent[],
  pull: PullRequest | null,
): string {
  const names = (agents: readonly Agent[]): string => listed(agents.map((agent) => agent.name));
  const number = pull === null ? "it" : `#${String(pull.number)}`;

  if (kind === "review") {
    const runner = staff[0]?.name ?? stack.name;

    return `${runner} runs ${number} and screenshots it against main. ${stack.name} drafts comments for you to send.`;
  }

  if (kind === "babysit") {
    const fixer = staff[0]?.name ?? stack.name;
    const first = pull?.author.name.split(" ")[0];
    const mine = pull === null || pull.author.id === "you";

    return `${WATCHER} watches ${number} without a model. ${fixer} fixes what fails${mine ? "" : `, and asks before pushing to ${first ?? "their"}'s branch`}.`;
  }

  const writer = staff[0]?.name ?? stack.name;
  const checkers = staff.slice(1);

  return `${writer} writes it in its own worktree${checkers.length === 0 ? "" : `, ${names(checkers)} ${checkers.length === 1 ? "checks" : "check"} it`}, then ${stack.name} reviews it and opens one pull request.`;
}

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");

  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}
