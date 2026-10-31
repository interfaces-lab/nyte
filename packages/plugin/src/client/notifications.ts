import type { RunEnd } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/client";
import { endedStatus, sessionTitle, taskLabel } from "./presentation.ts";

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
      const message = describeRunEnd(event.end);

      if (message !== undefined)
        api.ui.notify({
          title: sessionTitle(info),
          message,
          level: event.end.kind === "failed" ? "error" : "info",
        });
    },
  },
} satisfies Plugin;

/**
 * What to tell the user about a run's end: that it's done, or that it failed and why, on one
 * line of at most 120 characters. A stopped run says nothing, because someone asked for it.
 *
 * @category plugins
 */
export function describeRunEnd(end: RunEnd): string | undefined {
  const status = endedStatus(end);

  if (status.kind === "completed") return taskLabel("done");

  if (status.kind !== "failed") return undefined;
  const text = status.failure.message.replace(/\s+/g, " ").trim();

  return `${taskLabel("failed")}: ${text.length > 120 ? `${text.slice(0, 119)}…` : text}`;
}
