/**
 * Ref names. One function per ref family, so the layout of the ref namespace
 * lives here and nowhere else.
 *
 *   refs/heads/<head>              tip of a branch
 *   refs/stacks/<head>             where the branch sits: parent head and base commit
 *   refs/inbox/<head>/<delivery>/tip  newest submitted change for that delivery
 *   refs/inbox/<head>/<delivery>/base last landed change; pending is (base, tip]
 *   refs/runs/<head>               the branch's current run
 *   refs/chains/<root>             aggregate response attempts for one delegated chain
 *   refs/compactions/<head>        active checkpoint work under the head lease
 *   refs/effects/<run>/<call>      one tool call's durable state
 *   refs/keys/<key>                idempotency receipt for a submission
 *   refs/facts/<key>               a small session value
 *   refs/delegations/<child>/<change> a request this session sent a child, and whether its answer landed here
 *   refs/cancelled/<change>        a submitted change withdrawn before it landed
 *   refs/deleted                   the session is being deleted; runs may not publish
 *
 * Each head has two inbox chains. `steer` lands at every boundary and when
 * idle. `next` lands only when idle. The default head belongs to the SDK.
 */
import { randomUUID } from "node:crypto";
import { isHeadName } from "@nyte-ai/protocol";
import type { Delivery } from "@nyte-ai/protocol";
import type { Oid, RefName } from "./model.ts";

export { isHeadName };

export const DELETED_REF: RefName = "refs/deleted";

const HEADS = "refs/heads/";

const STACKS = "refs/stacks/";

const INBOX = "refs/inbox/";

const RUNS = "refs/runs/";

const CHAINS = "refs/chains/";

const COMPACTIONS = "refs/compactions/";

const EFFECTS = "refs/effects/";

const KEYS = "refs/keys/";

const FACTS = "refs/facts/";

const DELEGATIONS = "refs/delegations/";

const CANCELLED = "refs/cancelled/";

export function headRef(head: string): RefName {
  return HEADS + head;
}

export function stackRef(head: string): RefName {
  return STACKS + head;
}

export function inboxTipRef(head: string, delivery: Delivery): RefName {
  return `${INBOX}${head}/${delivery}/tip`;
}

export function inboxBaseRef(head: string, delivery: Delivery): RefName {
  return `${INBOX}${head}/${delivery}/base`;
}

export function inboxPrefix(head: string): string {
  return `${INBOX}${head}/`;
}

export interface InboxRefParts {
  readonly head: string;
  readonly delivery: Delivery;
  readonly position: "tip" | "base";
}

export function parseInboxRef(name: RefName): InboxRefParts | undefined {
  if (!name.startsWith(INBOX)) return undefined;
  const parts = name.slice(INBOX.length).split("/");
  const [head, delivery, position] = parts;

  if (
    parts.length !== 3 ||
    head === undefined ||
    delivery === undefined ||
    !isHeadName(head) ||
    !isDelivery(delivery) ||
    (position !== "tip" && position !== "base")
  ) {
    return undefined;
  }

  return { head, delivery, position };
}

export function runRef(head: string): RefName {
  return RUNS + head;
}

export function chainRef(root: string): RefName {
  return CHAINS + root;
}

export function compactionRef(head: string): RefName {
  return COMPACTIONS + head;
}

export function parseCompactionRef(name: RefName): string | undefined {
  if (!name.startsWith(COMPACTIONS)) return undefined;
  const head = name.slice(COMPACTIONS.length);

  return isHeadName(head) ? head : undefined;
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

export function delegationRef(child: string, change: Oid): RefName {
  return `${DELEGATIONS}${child}/${change}`;
}

/** Every request one child was sent, for `refs.list`. */
export function delegationPrefix(child: string): string {
  return `${DELEGATIONS}${child}/`;
}

/**
 * Plugin storage keys hold any text, so they are escaped into the ref name
 * byte by byte; a session fact is written raw and never contains "%".
 */
export function encodeFactKey(key: string): string {
  if (key === "") return "%_";

  return [...new TextEncoder().encode(key)]
    .map((byte) => {
      const character = String.fromCharCode(byte);

      return /^[A-Za-z0-9_-]$/.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

export function decodeFactKey(key: string): string {
  if (key === "%_") return "";
  const bytes: number[] = [];

  for (let index = 0; index < key.length; index += 1) {
    const character = key[index];

    if (character !== "%") {
      if (character === undefined) throw new Error(`Malformed encoded fact key: ${key}`);
      bytes.push(character.charCodeAt(0));
      continue;
    }

    const hex = key.slice(index + 1, index + 3);

    if (!/^[0-9A-F]{2}$/.test(hex)) throw new Error(`Malformed encoded fact key: ${key}`);
    bytes.push(Number.parseInt(hex, 16));
    index += 2;
  }

  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** Tombstone for a submitted change: pending walks skip it, landing advances past it. */
export function cancelledRef(change: Oid): RefName {
  return CANCELLED + change;
}

export const HEAD_PREFIX = HEADS;

export const STACK_PREFIX = STACKS;

export const CHAIN_PREFIX = CHAINS;

export const DELEGATION_PREFIX = DELEGATIONS;

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

export function isDelivery(value: string): value is Delivery {
  return value === "steer" || value === "next";
}

export function newRunId(): string {
  return `run_${randomUUID().slice(0, 12)}`;
}

export function newOwnerId(): string {
  return `owner_${randomUUID().slice(0, 12)}`;
}
