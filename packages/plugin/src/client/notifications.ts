import type { RunEnd } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/client";

/**
 * Tells the user when a run ends in any session this client can see:
 * finished, or failed with the reason. A stopped run stays quiet because
 * someone asked for it, and so do sessions a parent spawned, so a delegation
 * does not ring once per child.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "notifications",
  hooks: {
    run_ended_anywhere: async (event, { api }) => {
      const info = await api.sdk.session(event.session).info();

      if (info.parent !== null) return;
      const message = describeRunEnd(event.end);

      if (message !== undefined)
        api.ui.notify({
          title: info.name ?? undefined,
          message,
          level: event.end.kind === "failed" ? "error" : "info",
        });
    },
  },
} satisfies Plugin;

/**
 * What to tell the user about a run's end: that it finished, or that it failed and why, on one
 * line of at most 120 characters. A stopped run says nothing, because someone asked for it.
 *
 * @category plugins
 */
export function describeRunEnd(end: RunEnd): string | undefined {
  if (end.kind === "completed") return "Run finished";

  if (end.kind === "stopped") return undefined;
  const text = end.failure.message.replace(/\s+/g, " ").trim();

  return `Run failed: ${text.length > 120 ? `${text.slice(0, 119)}…` : text}`;
}
