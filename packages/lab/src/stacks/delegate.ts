import { MODELS, SURFACES, YOU } from "./model.ts";
import type { Item, PullRequest, Stack } from "./model.ts";
import { babysitSteps, fixSteps, reviewSteps, schedule } from "./script.ts";

export type Request =
  | {
      readonly kind: "fix";
      readonly text: string;
      readonly title?: string;
      readonly images?: readonly string[];
    }
  | {
      readonly kind: "babysit" | "review";
      readonly text: string;
      readonly pull: PullRequest;
      readonly images?: readonly string[];
    };

const PULL_URL = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/;

const PULL_REF = /(?:^|\s)#(\d+)\b/;

/** What the composer's text asks for: a pull request to watch or review, or a fix to write. */
export function readRequest(text: string, pulls: readonly PullRequest[]): Request | null {
  const trimmed = text.trim();

  if (trimmed === "") return null;
  const match = PULL_URL.exec(trimmed) ?? PULL_REF.exec(trimmed);

  if (match === null) return { kind: "fix", text: trimmed };
  const number = Number(match[1]);

  const pull = pulls.find((candidate) => candidate.number === number) ?? {
    number,
    title: `Pull request #${String(number)}`,
    author: { id: "someone", name: "A teammate", initials: "?", tone: "green" },
    opened: "just now",
    branch: "",
    surface: SURFACES.unknown,
  };

  return { kind: /\breview\b/i.test(trimmed) ? "review" : "babysit", text: trimmed, pull };
}

/** One line on who will do what, shown while you type. */
export function describePlan(request: Request, stack: Stack): string {
  const writes = MODELS[stack.crew.writes].short;
  const reviews = MODELS[stack.crew.reviews].short;
  const watches = MODELS[stack.crew.watches].short;

  if (request.kind === "fix")
    return `${writes} writes it in its own worktree, ${reviews} reviews it, then one pull request.`;
  const number = `#${String(request.pull.number)}`;

  if (request.kind === "review")
    return `${reviews} runs ${number}, screenshots it against main, and drafts comments for you to send.`;

  if (request.pull.author.id === YOU.id)
    return `${watches} watches ${number} until it merges and fixes what fails on your branch.`;

  return `${watches} watches ${number} until it merges and asks before pushing to ${firstName(request.pull.author.name)}'s branch.`;
}

export function createItem(
  request: Request,
  stack: Stack,
  id: string,
  number: number,
  clock: number,
): Item {
  const plan = describePlan(request, stack);
  const images = request.images ?? [];

  const asked = {
    id: `${id}-asked`,
    who: "You",
    what: "asked",
    at: clock,
    text: request.text,
    mine: true,
    attachment: images.length === 0 ? undefined : { images },
  };

  const shared = {
    id,
    stack: stack.id,
    ask: null,
    shot: null,
    files: [],
    findings: [],
    updated: clock,
    script: [],
    due: clock,
  };

  if (request.kind === "fix") {
    const writes = MODELS[stack.crew.writes];
    const title = request.title ?? titleFrom(request.text);

    return schedule(
      {
        ...shared,
        number: null,
        kind: "fix",
        title,
        summary: plan,
        status: "working",
        now: "Queued",
        author: YOU,
        branch: `${stack.id}/${slug(title)}`,
        surface: SURFACES.unknown,
        checks: [],
        sessions: [{ duty: "writes", model: writes.id, state: "Starting", turns: 0, cost: 0 }],
        activity: [asked],
      },
      fixSteps(stack, number),
      clock,
    );
  }

  const pull = request.pull;
  const duty = request.kind === "review" ? "reviews" : "watches";
  const model = MODELS[stack.crew[duty]];
  const mine = pull.author.id === YOU.id;

  return schedule(
    {
      ...shared,
      number: pull.number,
      kind: request.kind,
      title: pull.title,
      summary: mine
        ? "Your pull request."
        : `${firstName(pull.author.name)}'s pull request, opened ${pull.opened}.`,
      status: request.kind === "review" ? "working" : "watching",
      now: request.kind === "review" ? `${model.short} is starting` : "CI queued",
      author: pull.author,
      branch: pull.branch,
      surface: pull.surface,
      checks: [],
      sessions: [{ duty, model: model.id, state: "Starting", turns: 0, cost: 0 }],
      activity: [
        asked,
        { id: `${id}-plan`, who: model.short, what: "took it", at: clock, text: plan },
      ],
    },
    request.kind === "review" ? reviewSteps(stack, pull) : babysitSteps(stack, pull, mine),
    clock,
  );
}

export function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function titleFrom(text: string): string {
  const sentence = text.split(/[.\n]/)[0]?.trim() ?? text;
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
