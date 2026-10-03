/**
 * Attention from the event stream: a run that stops, a question that parks.
 * The plugin decides what deserves the user's attention and says so through
 * `diagnostics.notify`; the client decides how that looks. Chats a parent
 * spawned stay quiet, so a delegation does not ring once per child. A
 * listener's rejection is reported by the host, so none is caught here.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/feature-plugins/system/notifications.ts
 */
import { definePlugin } from "@nyte-ai/plugin";
import type { EndedRun } from "@nyte-ai/plugin";
import type { JsonValue } from "@nyte-ai/schema";

export const NOTIFICATIONS_SETTING_ID = "run-alerts";

/** Desktop notifications truncate without warning, so bound the provider text here. */
const MAX_DETAIL_CHARS = 120;

function summarize(message: string): string {
  const collapsed = message.replaceAll(/\s+/gu, " ").trim();

  if (collapsed.length <= MAX_DETAIL_CHARS) return collapsed;

  return `${collapsed.slice(0, MAX_DETAIL_CHARS - 1).trimEnd()}…`;
}

/** What stopped the run, not just that it stopped: an error must not read as a clean finish. */
export function runEndMessage(phase: EndedRun["phase"]): string {
  switch (phase.kind) {
    case "done":
      return "Turn finished";
    case "aborted":
      return "Turn stopped";
    case "failed": {
      const detail = summarize(phase.failure.message);

      return detail === "" ? "Turn failed" : `Turn failed: ${detail}`;
    }
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function questionTitle(args: JsonValue): string | undefined {
  if (!isJsonObject(args)) return undefined;
  const question = args["question"];

  return isString(question) ? summarize(question) : undefined;
}

export const notificationsPlugin = definePlugin({
  id: "notifications",
  session(api) {
    const alerts = api.settings.add(NOTIFICATIONS_SETTING_ID, {
      label: "Run alerts",
      default: "alert",
      choices: [
        { id: "alert", label: "alert", description: "Show an alert when each run stops" },
        {
          id: "sound",
          label: "alert + sound",
          description: "Show the alert and ring the terminal bell",
        },
        { id: "off", label: "off", description: "Don't alert when runs stop" },
      ],
    });

    let child: boolean | undefined;

    const notify = async (message: string, title?: string): Promise<void> => {
      const mode = await alerts.get();

      if (mode === "off") return;
      child ??= (await api.session.info()).child;

      if (child) return;
      const notification = { message, sound: mode === "sound" };
      api.diagnostics.notify(title === undefined ? notification : { ...notification, title });
    };

    api.events.subscribe("run_ended", (event) => notify(runEndMessage(event.run.phase)));
    api.events.subscribe("awaiting_reply", (event) =>
      notify("Input needs response", questionTitle(event.args)),
    );
  },
});
