import type { Lane, ModelChoice, SkillRef } from "./lane.ts";

export interface Prompt {
  readonly id: string;
  readonly title: string;
  readonly to: string;
  readonly model: string | null;
  readonly skills: readonly SkillRef[];
  readonly text: string;
}

export function modelName(model: ModelChoice): string {
  return `${model.provider}/${model.id} · thinking ${model.thinking}`;
}

export function setupPrompt(
  intent: string,
  attached: readonly { readonly name: string; readonly messages: number }[],
  lane: Lane,
): Prompt {
  return {
    id: "setup",
    title: "Lane setup",
    to: "a new setup chat",
    model: modelName(lane.rules.roles.reviewer.model),
    skills: [],
    text: [
      "You are setting up a lane: rules that every chat in it follows on every turn. Ask only for what you cannot find yourself, and start no work until the user confirms.",
      "",
      `The user wants: "${intent}"`,
      "",
      "Propose the lane as a form, one field at a time:",
      "- Name, and one sentence on what work belongs here and what does not.",
      `- Skills for the worker, the reviewer and the babysitter, by name and file location. Start from the skills this user attaches by hand most (${attached.map((skill) => `${skill.name} ${String(skill.messages)}×`).join(", ")}) and the ones in this repository's .agents/skills.`,
      '- A model for each role as provider/id from /model, with a thinking level. A bare "sol" or "opus" is rejected: write openai-codex/gpt-6.1-sol and anthropic/claude-opus-5-5.',
      "- Commit and pull request rules, read from AGENTS.md: message format, branch names, base branch, who commits and opens the PR, what is never allowed.",
      "- The gate: which workflows must pass before a PR counts as ready. Read .github/workflows; leave out checks AGENTS.md forbids satisfying.",
      "- Triggers: what starts or follows work, on which model, until when, within what budget.",
      "- Limits: workers at once, watched pull requests, spend per day, how long a babysitter lives.",
      "- What is missing before the first fix: run `gh auth status`, and list any MCP server the rules need that ~/.nyte/mcp.json lacks.",
    ].join("\n"),
  };
}

export function workerBrief(lane: Lane, task: string, worktree: string, branch: string): Prompt {
  return {
    id: "worker",
    title: "Worker brief",
    to: "a new worker chat",
    model: modelName(lane.rules.roles.worker.model),
    skills: lane.rules.roles.worker.skills,
    text: [
      task,
      "",
      `You work alone in ${worktree} on branch ${branch}, made from ${lane.rules.checkout.from} with nothing copied in. No other chat writes here.`,
      "Make the smallest complete fix. Follow the attached skills and AGENTS.md.",
      "Do not commit, push or open a pull request; the reviewer does.",
      "When you are done, reply with what you changed, why, and the command that shows it works.",
    ].join("\n"),
  };
}

export function reviewerBrief(lane: Lane, worker: string, worktree: string, diff: string): Prompt {
  return {
    id: "reviewer",
    title: "Reviewer brief",
    to: "the lane's reviewer",
    model: modelName(lane.rules.roles.reviewer.model),
    skills: lane.rules.roles.reviewer.skills,
    text: [
      `${worker} finished in ${worktree}. Its diff against ${lane.rules.checkout.from}: ${diff}.`,
      "",
      "Review it for code quality with the attached principles-review skill and for UI correctness with better-interface. Open the changed screens and look; do not judge a screen from its diff.",
      "- If it needs changes, send them to the worker in one message, as a list with file:line, and wait for its reply.",
      `- If it is right, the writer lease is yours: commit in that worktree as ${lane.rules.commit.message}, push the branch, and open the pull request against ${lane.rules.pullRequest.base}. The lane links it and starts its babysitter.`,
      "Never rewrite the fix yourself.",
    ].join("\n"),
  };
}

export function babysitterBrief(
  lane: Lane,
  input: {
    readonly number: number;
    readonly title: string;
    readonly branch: string;
    readonly worktree: string;
    readonly author: string;
  },
): Prompt {
  const budget = lane.rules.limits.perPullRequest;

  return {
    id: `babysitter-${String(input.number)}`,
    title: `Babysitter brief for #${String(input.number)}`,
    to: `a new child of ${input.author}`,
    model: modelName(lane.rules.roles.babysitter.model),
    skills: lane.rules.roles.babysitter.skills,
    text: [
      `You babysit pull request #${String(input.number)} (${input.title}) on branch ${input.branch} until it is ready to merge: every ${lane.rules.pullRequest.gate.join(", ")} check passes on its head, no review thread is unresolved, and GitHub can merge it. Merging is the user's call.`,
      "",
      `You are woken only when something changed, and each message says what. You hold the writer lease of ${input.worktree} while you run.`,
      `- Fix only what this pull request causes. A failure that also fails on its base is not yours: the lane fixes it once there.`,
      "- Keep each fix small, in the attached skills' style, one commit each.",
      `- Never: ${lane.rules.never.join("; ")}.`,
      `- If a fix needs a decision the author made, ask ${input.author} with send and wait.`,
      `Budget: ${String(budget.attempts)} fix runs and $${budget.usd.toFixed(2)}. When you stop, say why in one line.`,
    ].join("\n"),
  };
}

export function dragNotice(
  lane: Lane,
  input: {
    readonly session: string;
    readonly pulls: readonly number[];
    readonly babysitters: readonly string[];
  },
): Prompt {
  return {
    id: "drag",
    title: "Lane notice before the dragged chat's next turn",
    to: input.session,
    model: null,
    skills: [],
    text: [
      `This chat is now in the ${lane.name} lane. From your next turn you follow its rules: the attached skills, commits as ${lane.rules.commit.message}, pull requests against ${lane.rules.pullRequest.base}.`,
      `Your pull requests ${input.pulls.map((pull) => `#${String(pull)}`).join(", ")} each have a babysitter on ${lane.rules.roles.babysitter.model.provider}/${lane.rules.roles.babysitter.model.id} (${input.babysitters.join(", ")}). One messages you only if a fix needs a decision you made.`,
      "Keep going with what you were doing.",
    ].join("\n"),
  };
}

export function restackQuestion(base: string, branches: readonly string[]): Prompt {
  return {
    id: "restack",
    title: "Question to you",
    to: "you",
    model: null,
    skills: [],
    text: `${base} has the fix. Rebase the stack of ${String(branches.length)} pull requests onto it? This force-pushes ${branches.join(", ")}; every old head stays in refs/nyte/kept.`,
  };
}

export function escalation(input: {
  readonly number: number;
  readonly check: string;
  readonly where: string;
  readonly author: string;
}): Prompt {
  return {
    id: `escalation-${String(input.number)}`,
    title: "Babysitter to author",
    to: input.author,
    model: null,
    skills: [],
    text: `#${String(input.number)}: ${input.check} fails in code you wrote, ${input.where}. Is what the test expects still what you meant? Reply with the change, or say "yours" and I will make it.`,
  };
}
