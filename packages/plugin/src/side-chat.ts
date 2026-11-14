import type { Connection, Session } from "@nyte-ai/core";
import type { HookHandler } from "@nyte-ai/plugin/core";

/**
 * Whether a session only reads: a side chat, or a session one started at any
 * depth. A side chat's window has no tray for approvals, questions or secrets,
 * and a subagent's asks show on its parent's, so such a session is never
 * offered a tool that changes something or waits on the person, and a call to
 * one is refused.
 */
export async function readsOnly(
  session: Pick<Session, "info">,
  sdk: Pick<Connection, "session">,
): Promise<boolean> {
  const info = await session.info();

  if (info.side === true) return true;

  return info.parent === null ? false : readsOnly(sdk.session(info.parent), sdk);
}

/** Keeps the tool `name` out of the requests of a session that only reads. */
export function withheldInSideChats(name: string): HookHandler<"transform_transcript"> {
  return async (transcript, context) =>
    (await readsOnly(context.api.session, context.api.sdk))
      ? { ...transcript, tools: transcript.tools.filter((info) => info.name !== name) }
      : transcript;
}
