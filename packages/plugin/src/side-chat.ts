import type { Connection, Session } from "@nyte-ai/core";
import type { HookHandler } from "@nyte-ai/plugin/core";

export async function readsOnly(
  session: Pick<Session, "info">,
  sdk: Pick<Connection, "session">,
): Promise<boolean> {
  const info = await session.info();

  if (info.side === true) return true;

  return info.parent === null ? false : readsOnly(sdk.session(info.parent), sdk);
}

export function withheldInSideChats(name: string): HookHandler<"transform_transcript"> {
  return async (transcript, context) =>
    (await readsOnly(context.api.session, context.api.sdk))
      ? { ...transcript, tools: transcript.tools.filter((info) => info.name !== name) }
      : transcript;
}
