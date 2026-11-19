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

export function withheldInSideChats(name: string): HookHandler<"offer_tools"> {
  return async (tools, context) =>
    (await readsOnly(context.api.session, context.api.sdk))
      ? tools.filter((info) => info.name !== name)
      : tools;
}
