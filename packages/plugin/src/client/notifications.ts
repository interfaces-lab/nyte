import type { Failure } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/client";
import { endedStatus, sessionTitle } from "./presentation.ts";

/**
 * Tells the user when a run ends in a session this client can see but nobody
 * is looking at: finished, or failed with the reason. A session someone is
 * looking at shows its own result, a stopped run stays quiet because someone
 * asked for it, and so do sessions a parent spawned, so a delegation does not
 * ring once per child.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "notifications",
  hooks: {
    run_ended_anywhere: async (event, { api }) => {
      if (api.looking.has(event.session)) return;
      const info = await api.sdk.session(event.session).info();

      if (info.parent !== null) return;
      const title = sessionTitle(info);
      const status = endedStatus(event.end);

      if (status.kind === "completed")
        api.ui.notify({ title, message: "Run finished", level: "info" });
      else if (status.kind === "failed")
        api.ui.notify({ title, message: `Run failed: ${line(status.failure)}`, level: "error" });
    },
  },
} satisfies Plugin;

/** Returns a failure's message as one line of at most 120 characters. */
function line(failure: Failure): string {
  const text = failure.message.replace(/\s+/g, " ").trim();

  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}
