import type { HeadName, Message, MessageId, PrincipalId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

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
