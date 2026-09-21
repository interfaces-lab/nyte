import { isTerminalPhase } from "@nyte-ai/protocol";
import type { RunId, RunOrigin } from "@nyte-ai/protocol";
import { authorizedContinuation } from "./delegation-record.ts";
import type { RefUpdate, Run } from "./model.ts";
import type { PendingChange } from "./queue.ts";
import type { Session } from "./store.ts";

export type Head =
  | { readonly kind: "fresh" }
  | { readonly kind: "idle"; readonly last: Run }
  | { readonly kind: "live"; readonly run: Run }
  | { readonly kind: "settling" };

export type Lead =
  | { readonly kind: "none" }
  | { readonly kind: "user" }
  | { readonly kind: "passive" }
  | { readonly kind: "report" }
  | {
      readonly kind: "answer";
      readonly authorization:
        | {
            readonly kind: "authorized";
            readonly root: RunId;
            readonly consume: RefUpdate;
            readonly origin: Extract<RunOrigin, { readonly kind: "continuation" }>;
          }
        | { readonly kind: "none" };
    };

export type Decision =
  | { readonly kind: "wait" }
  | { readonly kind: "join"; readonly run: Run }
  | { readonly kind: "handoff"; readonly run: Run }
  | { readonly kind: "settle"; readonly run: Run }
  | {
      readonly kind: "start";
      readonly origin: RunOrigin;
      readonly chain:
        | { readonly kind: "new" }
        | { readonly kind: "inherit"; readonly root: RunId; readonly consume: RefUpdate };
    };

export function headFor(run: Run | undefined): Head {
  if (run === undefined) return { kind: "fresh" };
  if (isTerminalPhase(run.phase)) return { kind: "idle", last: run };
  return run.abortRequested === true ? { kind: "settling" } : { kind: "live", run };
}

export function decide(head: Head, lead: Lead, agentChanged: boolean): Decision {
  switch (head.kind) {
    case "settling":
      switch (lead.kind) {
        case "none":
        case "user":
        case "passive":
        case "report":
        case "answer":
          return { kind: "wait" };
        default: {
          const _exhaustive: never = lead;
          return _exhaustive;
        }
      }
    case "live":
      switch (lead.kind) {
        case "none":
          return { kind: "wait" };
        case "user":
        case "passive":
        case "report":
        case "answer":
          return agentChanged
            ? { kind: "handoff", run: head.run }
            : { kind: "join", run: head.run };
        default: {
          const _exhaustive: never = lead;
          return _exhaustive;
        }
      }
    case "fresh":
      switch (lead.kind) {
        case "none":
        case "passive":
        case "report":
          return { kind: "wait" };
        case "user":
          return { kind: "start", origin: { kind: "user" }, chain: { kind: "new" } };
        case "answer":
          switch (lead.authorization.kind) {
            case "none":
              return { kind: "wait" };
            case "authorized":
              return {
                kind: "start",
                origin: lead.authorization.origin,
                chain: {
                  kind: "inherit",
                  root: lead.authorization.root,
                  consume: lead.authorization.consume,
                },
              };
            default: {
              const _exhaustive: never = lead.authorization;
              return _exhaustive;
            }
          }
        default: {
          const _exhaustive: never = lead;
          return _exhaustive;
        }
      }
    case "idle":
      switch (lead.kind) {
        case "none":
        case "report":
          return { kind: "wait" };
        case "passive":
          return { kind: "settle", run: head.last };
        case "user":
          return { kind: "start", origin: { kind: "user" }, chain: { kind: "new" } };
        case "answer":
          switch (lead.authorization.kind) {
            case "none":
              return { kind: "wait" };
            case "authorized":
              return {
                kind: "start",
                origin: lead.authorization.origin,
                chain: {
                  kind: "inherit",
                  root: lead.authorization.root,
                  consume: lead.authorization.consume,
                },
              };
            default: {
              const _exhaustive: never = lead.authorization;
              return _exhaustive;
            }
          }
        default: {
          const _exhaustive: never = lead;
          return _exhaustive;
        }
      }
    default: {
      const _exhaustive: never = head;
      return _exhaustive;
    }
  }
}

export function nextBatch(
  changes: readonly PendingChange[],
  drain: "one" | "all",
): readonly PendingChange[] {
  if (drain === "all") return changes;
  const message = changes.findIndex((item) => item.change.kind === "user");
  return message === -1 ? changes : changes.slice(0, message + 1);
}

export function boundaryBatch(
  changes: readonly PendingChange[],
  drain: "one" | "all",
  awaitingAnswer: boolean,
): readonly PendingChange[] {
  const batch = nextBatch(changes, drain);
  if (!awaitingAnswer) return batch;
  const end = batch.findIndex(
    (item) => item.change.kind !== "answer" && item.change.kind !== "report",
  );
  return end === -1 ? batch : batch.slice(0, end);
}

export async function leadFor(session: Session, changes: readonly PendingChange[]): Promise<Lead> {
  const first = changes.find((item) => item.change.kind !== "passive");
  if (first === undefined) return changes.length === 0 ? { kind: "none" } : { kind: "passive" };
  switch (first.change.kind) {
    case "user":
      return { kind: "user" };
    case "report":
      return { kind: "report" };
    case "answer": {
      const authorization = await authorizedContinuation(session, first);
      return authorization === undefined
        ? { kind: "answer", authorization: { kind: "none" } }
        : {
            kind: "answer",
            authorization: {
              kind: "authorized",
              root: authorization.root,
              consume: authorization.consume,
              origin: {
                kind: "continuation",
                session: authorization.session,
                request: authorization.request,
              },
            },
          };
    }
    case "passive":
      return { kind: "passive" };
    default: {
      const _exhaustive: never = first.change.kind;
      return _exhaustive;
    }
  }
}

export function agentChanged(run: Run | undefined, changes: readonly PendingChange[]): boolean {
  if (run === undefined) return false;
  let agent = run.config.agent;
  for (const { change } of changes) {
    if (change.body.kind === "message" && change.body.agent !== undefined) {
      agent = change.body.agent;
    }
  }
  return agent !== run.config.agent;
}

export async function landsNow(
  session: Session,
  run: Run | undefined,
  queued: readonly PendingChange[],
  drain: "one" | "all",
): Promise<boolean> {
  const head = headFor(run);
  const deliveries = head.kind === "live" ? (["steer"] as const) : (["steer", "next"] as const);
  for (const delivery of deliveries) {
    const batch = nextBatch(
      queued.filter((item) => item.delivery === delivery),
      drain,
    );
    const lead = await leadFor(session, batch);
    if (decide(head, lead, agentChanged(run, batch)).kind !== "wait") return true;
  }
  return false;
}
