import type { RunEnd } from "@nyte-ai/schema";
import type { Plugin } from "./client.ts";

/**
 * Tells the user when a run ends in any session this client can see:
 * finished, stopped, or failed with the reason. Sessions a parent spawned
 * stay quiet, so a delegation does not ring once per child.
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
      const title = info.name ?? undefined;
      const { end } = event;

      if (end.kind === "completed") api.ui.notify({ title, message: "Run finished", level: "info" });
      else if (end.kind === "stopped") api.ui.notify({ title, message: "Run stopped", level: "warning" });
      else api.ui.notify({ title, message: `Run failed: ${line(end)}`, level: "error" });
    },
  },
} satisfies Plugin;

/** Returns a failure's message as one line of at most 120 characters. */
function line(end: Extract<RunEnd, { readonly kind: "failed" }>): string {
  const text = end.failure.message.replace(/\s+/g, " ").trim();

  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}
