import type {
  CommitId,
  HeadName,
  Message,
  MessageId,
  PrincipalId,
  SessionId,
  SessionView,
  ViewOptions,
} from "@nyte-ai/schema";
import type { FoldState } from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import { closable, coalesce, DONE, latest } from "../util/iterable.ts";
import { project, readSeenCommit } from "./fold.ts";
import { seenWriter } from "./seen.ts";

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
    const seen = seenWriter(kernel, input);
    let states: AsyncIterator<FoldState> | null = null;
    let closed = false;
    let shown: SessionView | null = null;
    let marked: CommitId | null | undefined;

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
          const state = hold.state();
          const view = project(state, input.head, input.options);

          if (view === shown) continue;
          shown = view;
          const head = state.heads.get(input.head);
          const tip = head?.info.tip.kind === "commit" ? head.info.tip.id : null;

          if (head !== undefined && tip !== readSeenCommit(state, input.head) && tip !== marked) {
            marked = tip;
            seen.note(tip);
          }

          return { done: false, value: view };
        }
      },
      close() {
        closed = true;
        void states?.return?.();
        hold.release();

        return seen.flush();
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

export async function historyHead(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly principal: PrincipalId;
    readonly before: MessageId;
    readonly limit: number;
  },
): Promise<readonly Message[]> {
  const hold = kernel.folds.acquire(input.session, input.principal);

  try {
    await hold.ready();
    const messages = hold.state().heads.get(input.head)?.messages ?? [];
    const end = messages.findIndex((message) => message.id === input.before);

    if (end < 0 || input.limit <= 0) return [];

    return messages.slice(Math.max(0, end - input.limit), end);
  } finally {
    hold.release();
  }
}
