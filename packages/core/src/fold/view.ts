import type {
  HeadName,
  HistoryPage,
  MessageId,
  PartId,
  PartView,
  PrincipalId,
  SessionId,
  SessionView,
  ViewOptions,
} from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { FoldState } from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { PartRecord } from "../contract/records.ts";
import { closable, coalesce, DONE, latest } from "../util/iterable.ts";
import { partView } from "./draft.ts";
import { findLeadingPrompt, project } from "./project.ts";

export function watchHead(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly principal: PrincipalId;
    readonly options?: ViewOptions;
  },
): AsyncIterable<SessionView> {
  return closable<SessionView>(() => {
    const hold = kernel.folds.acquire(input.session, input.principal);
    let states: AsyncIterator<FoldState> | null = null;
    let closed = false;
    let shown: SessionView | null = null;

    return {
      async pull() {
        if (states === null) {
          await hold.ready();

          if (closed) return DONE;
          states = coalesce(latest(hold.state(), (push) => hold.subscribe(push)))[
            Symbol.asyncIterator
          ]();
        }

        for (;;) {
          const next = await states.next();

          if (next.done || closed) return DONE;
          const view = project(hold.state(), input.head, input.options);

          if (view === shown) continue;
          shown = view;

          return { done: false, value: view };
        }
      },
      close() {
        closed = true;
        void states?.return?.();
        hold.release();
      },
    };
  });
}

/** One part's view each time the fold changes it, from whatever head holds it; `null` while the session has no such part. */
export function watchPart(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly principal: PrincipalId;
  },
): AsyncIterable<PartView | null> {
  return closable<PartView | null>(() => {
    const hold = kernel.folds.acquire(input.session, input.principal);
    let states: AsyncIterator<FoldState> | null = null;
    let closed = false;
    let shown: { readonly record: PartRecord | null } | null = null;

    return {
      async pull() {
        if (states === null) {
          await hold.ready();

          if (closed) return DONE;
          states = coalesce(latest(hold.state(), (push) => hold.subscribe(push)))[
            Symbol.asyncIterator
          ]();
        }

        for (;;) {
          const next = await states.next();

          if (next.done || closed) return DONE;
          const record = hold.state().parts.get(input.part) ?? null;

          if (shown !== null && shown.record === record) continue;
          shown = { record };

          return { done: false, value: record === null ? null : partView(record) };
        }
      },
      close() {
        closed = true;
        void states?.return?.();
        hold.release();
      },
    };
  });
}

export async function viewHead(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly principal: PrincipalId;
    readonly options?: ViewOptions;
  },
): Promise<SessionView> {
  const hold = kernel.folds.acquire(input.session, input.principal);

  try {
    await hold.ready();

    return project(hold.state(), input.head, input.options);
  } finally {
    hold.release();
  }
}

/** The `limit` messages of a head before `before`, with the turns they belong to and the prompt of the earliest of those turns when it is before them. */
export async function historyHead(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly principal: PrincipalId;
    readonly before: MessageId;
    readonly limit: number;
  },
): Promise<HistoryPage> {
  const hold = kernel.folds.acquire(input.session, input.principal);

  try {
    await hold.ready();
    const state = hold.state();
    const folded = state.heads.get(input.head);
    const path = state[INDEX].paths.get(input.head);
    const messages = folded?.messages ?? [];
    const end = messages.findIndex((message) => message.id === input.before);

    if (folded === undefined || path === undefined || end < 0 || input.limit <= 0)
      return { messages: [], leadingPrompt: null, turns: [] };
    const start = Math.max(0, end - input.limit);
    const page = messages.slice(start, end);

    const positions = [
      ...new Set(page.flatMap((message) => path.turnAt.get(message.turn) ?? [])),
    ].toSorted((left, right) => left - right);

    return {
      messages: page,
      leadingPrompt: findLeadingPrompt(path, start),
      turns: positions.flatMap((position) => folded.turns[position] ?? []),
    };
  } finally {
    hold.release();
  }
}
