/**
 * Ref names. One function per ref family, so the layout of the ref namespace
 * lives here and nowhere else.
 *
 *   refs/heads/<head>              tip of a branch
 *   refs/stacks/<head>             where the branch sits: parent head and base commit
 *   refs/queues/<head>/<lane>/tip  newest submitted change in that lane
 *   refs/queues/<head>/<lane>/base last landed change; pending is (base, tip]
 *   refs/runs/<head>               the branch's current run
 *   refs/effects/<run>/<call>      one tool call's durable state
 *   refs/keys/<key>                idempotency receipt for a submission
 *   refs/facts/<key>               a small session value
 *   refs/cancelled/<change>        a submitted change withdrawn before it landed
 *   refs/deleted                   the session is being deleted; runs may not publish
 *
 * Heads and lanes are names the caller chooses. The kernel knows the families,
 * never a particular head or lane; which lane lands when is the runner's
 * landing policy, and the default head is the SDK's.
 */
import { randomUUID } from "node:crypto";
import type { Oid, RefName } from "./model.ts";

export const DELETED_REF: RefName = "refs/deleted";

const HEADS = "refs/heads/";
const STACKS = "refs/stacks/";
const QUEUES = "refs/queues/";
const RUNS = "refs/runs/";
const EFFECTS = "refs/effects/";
const KEYS = "refs/keys/";
const FACTS = "refs/facts/";
const CANCELLED = "refs/cancelled/";

export function headRef(head: string): RefName {
  return HEADS + head;
}

export function stackRef(head: string): RefName {
  return STACKS + head;
}

export function queueTipRef(head: string, lane: string): RefName {
  return `${QUEUES}${head}/${lane}/tip`;
}

export function queueBaseRef(head: string, lane: string): RefName {
  return `${QUEUES}${head}/${lane}/base`;
}

/** Every queue ref of one head, for `refs.list`: how the lanes a head has are found. */
export function queuePrefix(head: string): string {
  return `${QUEUES}${head}/`;
}

export interface QueueRefParts {
  readonly head: string;
  readonly lane: string;
  readonly position: "tip" | "base";
}

/** The head, lane, and end a `refs/queues/*` name addresses, or undefined for any other ref. */
export function parseQueueRef(name: RefName): QueueRefParts | undefined {
  if (!name.startsWith(QUEUES)) return undefined;
  const parts = name.slice(QUEUES.length).split("/");
  const [head, lane, position] = parts;
  if (
    parts.length !== 3 ||
    head === undefined ||
    lane === undefined ||
    !isHeadName(head) ||
    !isLaneName(lane) ||
    (position !== "tip" && position !== "base")
  ) {
    return undefined;
  }
  return { head, lane, position };
}

export function runRef(head: string): RefName {
  return RUNS + head;
}

export function effectRef(runId: string, callId: string): RefName {
  return `${EFFECTS}${runId}/${callId}`;
}

/** Every effect ref of one run, for `refs.list`. */
export function effectPrefix(runId: string): string {
  return `${EFFECTS}${runId}/`;
}

export function keyRef(key: string): RefName {
  return KEYS + key;
}

export function factRef(key: string): RefName {
  return FACTS + key;
}

/** Tombstone for a submitted change: pending walks skip it, landing advances past it. */
export function cancelledRef(change: Oid): RefName {
  return CANCELLED + change;
}

export const HEAD_PREFIX = HEADS;
export const STACK_PREFIX = STACKS;
export const FACT_PREFIX = FACTS;
export const CANCELLED_PREFIX = CANCELLED;

/** The branch a `refs/heads/*` name points at, or undefined for any other ref. */
export function parseHeadRef(ref: RefName): string | undefined {
  return ref.startsWith(HEADS) && ref.length > HEADS.length ? ref.slice(HEADS.length) : undefined;
}

/**
 * Git's ref-name rules, the part that matters here: slash-separated
 * non-empty components, no `..`, no `@{`, no lone `@`, no control or space
 * characters, no component starting or ending with `.` or ending with
 * `.lock`, no trailing slash.
 */
export function isRefName(value: string): boolean {
  if (
    value === "" ||
    value === "@" ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("@{")
  ) {
    return false;
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === " " || char === "~" || char === "^") return false;
    if (char === ":" || char === "?" || char === "*" || char === "[" || char === "\\") return false;
  }
  return value
    .split("/")
    .every(
      (part) => part !== "" && part !== "@" && !part.startsWith(".") && !part.endsWith(".lock"),
    );
}

/** A branch name is one ref component: what `refs/heads/` may be followed by. */
export function isHeadName(value: string): boolean {
  return !value.includes("/") && isRefName(value);
}

/** A lane name is one ref component too: the segment between the head and `tip` or `base`. */
export function isLaneName(value: string): boolean {
  return !value.includes("/") && isRefName(value);
}

export function newRunId(): string {
  return `run_${randomUUID().slice(0, 12)}`;
}

export function newOwnerId(): string {
  return `owner_${randomUUID().slice(0, 12)}`;
}
