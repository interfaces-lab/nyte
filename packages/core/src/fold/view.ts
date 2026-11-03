import type {
  HeadName,
  HistoryPage,
  MessageId,
  PrincipalId,
  SessionId,
  SessionView,
  ViewOptions,
} from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import { findLeadingPrompt, showMessage } from "./project.ts";
import { readView } from "./window.ts";

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

    return readView(hold.state(), input.head, input.options);
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
    const page = messages.slice(start, end).map(showMessage);

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
