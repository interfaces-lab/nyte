import { SURFACES, YOU } from "./model.ts";
import type { Item, Kind, PullRequest, Stack } from "./model.ts";
import { babysitSteps, fixSteps, reviewSteps, schedule } from "./script.ts";
import { hands, leadAgent, mentioned, planSentence, propose, sessionFor } from "./staffing.ts";

/** A task as the composer read it: what kind, which pull request, and who works it. */
export interface Request {
  readonly kind: Kind;
  readonly text: string;
  readonly pull: PullRequest | null;
  readonly staff: readonly string[];
  readonly title?: string;
  readonly images?: readonly string[];
}

const PULL_URL = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/;

const PULL_REF = /(?:^|\s)#(\d+)\b/;

/**
 * A pull request in the text means watch it, or review it if you say review. Anything else is a
 * fix. Agents named with @ work it; without one, the lead picks.
 */
export function readRequest(
  text: string,
  stack: Stack,
  pulls: readonly PullRequest[],
): Request | null {
  const trimmed = text.trim();

  if (trimmed === "") return null;
  const match = PULL_URL.exec(trimmed) ?? PULL_REF.exec(trimmed);
  const named = mentioned(stack, trimmed);

  if (match === null)
    return {
      kind: "fix",
      text: trimmed,
      pull: null,
      staff: named.length > 0 ? named : propose(stack, "fix"),
    };
  const number = Number(match[1]);
  const kind = /\breview\b/i.test(trimmed) ? "review" : "babysit";

  const pull = pulls.find((candidate) => candidate.number === number) ?? {
    number,
    title: `Pull request #${String(number)}`,
    author: { id: "someone", name: "A teammate", initials: "?", tone: "green" },
    opened: "just now",
    branch: "",
    surface: SURFACES.unknown,
  };

  return { kind, text: trimmed, pull, staff: named.length > 0 ? named : propose(stack, kind) };
}

export function describePlan(request: Request, stack: Stack): string {
  return planSentence(stack, request.kind, hands(stack, request.staff), request.pull);
}

export function createItem(
  request: Request,
  stack: Stack,
  id: string,
  number: number,
  clock: number,
): Item {
  const staff = hands(stack, request.staff);
  const lead = leadAgent(stack);
  const images = request.images ?? [];
  const pull = request.pull;

  const base = {
    id,
    stack: stack.id,
    ask: null,
    shot: null,
    files: [],
    findings: [],
    checks: [],
    updated: clock,
    script: [],
    due: clock,
    sessions: [
      sessionFor(lead, "Planned it", 1, true),
      ...staff.map((agent) => sessionFor(agent, "Waiting", 0)),
    ],
    activity: [
      {
        id: `${id}-asked`,
        who: "You",
        what: "asked",
        at: clock,
        text: request.text,
        mine: true,
        attachment: images.length === 0 ? undefined : { images },
      },
      {
        id: `${id}-plan`,
        who: stack.name,
        what: "planned it",
        at: clock,
        text: planSentence(stack, request.kind, staff, pull),
      },
    ],
  };

  if (pull === null) {
    const title = request.title ?? titleFrom(request.text);

    return schedule(
      {
        ...base,
        number: null,
        kind: "fix",
        title,
        summary: planSentence(stack, "fix", staff, null),
        status: "working",
        now: "Queued",
        author: YOU,
        branch: `${stack.id}/${slug(title)}`,
        surface: SURFACES.unknown,
      },
      fixSteps(stack, number, staff),
      clock,
    );
  }

  const mine = pull.author.id === YOU.id;

  return schedule(
    {
      ...base,
      number: pull.number,
      kind: request.kind,
      title: pull.title,
      summary: mine
        ? "Your pull request."
        : `${firstName(pull.author.name)}'s pull request, opened ${pull.opened}.`,
      status: request.kind === "review" ? "working" : "watching",
      now: request.kind === "review" ? "Starting" : "CI queued",
      author: pull.author,
      branch: pull.branch,
      surface: pull.surface,
    },
    request.kind === "review"
      ? reviewSteps(stack, pull, staff)
      : babysitSteps(stack, pull, mine, staff),
    clock,
  );
}

export function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function titleFrom(text: string): string {
  const sentence =
    text
      .replace(/@[\w-]+/g, "")
      .split(/[.\n]/)[0]
      ?.trim() ?? text;

  const capped = sentence.length > 64 ? `${sentence.slice(0, 63).trimEnd()}…` : sentence;

  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 4)
    .join("-");
}
