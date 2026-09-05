/**
 * Attention from the event stream: a run that stops, a question that parks.
 * The plugin decides what deserves the user's attention and says so through
 * `diagnostics.notify`; the client decides how that looks. Chats a parent
 * spawned stay quiet, so a delegation does not ring once per child.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/feature-plugins/system/notifications.ts
 */
import { definePlugin } from "@nyte-ai/plugin";
import type { RunPhase } from "@nyte-ai/core";
import type { JsonValue } from "@nyte-ai/schema";

export const NOTIFICATIONS_SETTING_ID = "run-alerts";
const MODE_KEY = "mode";
const MODES = ["alert", "sound", "off"] as const;
type Mode = (typeof MODES)[number];
/** Desktop notifications truncate without warning, so bound the provider text here. */
const MAX_DETAIL_CHARS = 120;

function isMode(value: JsonValue | undefined): value is Mode {
  return MODES.some((mode) => mode === value);
}

function summarize(message: string): string {
  const collapsed = message.replaceAll(/\s+/gu, " ").trim();
  if (collapsed.length <= MAX_DETAIL_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_DETAIL_CHARS - 1).trimEnd()}…`;
}

/** What stopped the run, not just that it stopped: an error must not read as a clean finish. */
export function runEndMessage(phase: RunPhase): string | undefined {
  switch (phase.kind) {
    case "done":
      return "Turn finished";
    case "aborted":
      return "Turn stopped";
    case "failed": {
      const detail = summarize(phase.error);
      return detail === "" ? "Turn failed" : `Turn failed: ${detail}`;
    }
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return undefined;
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
    api.settings.add((draft) => {
      draft.set(NOTIFICATIONS_SETTING_ID, {
        label: "Run alerts",
        key: MODE_KEY,
        fallback: "alert",
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
    });

    let child: boolean | undefined;
    const notify = async (message: string, title?: string): Promise<void> => {
      const stored = await api.storage.get(MODE_KEY);
      const mode = isMode(stored) ? stored : "alert";
      if (mode === "off") return;
      child ??= (await api.session.info()).child;
      if (child) return;
      const notification = { message, sound: mode === "sound" };
      api.diagnostics.notify(title === undefined ? notification : { ...notification, title });
    };
    const report = (cause: unknown): void => {
      api.diagnostics.warn(`notify: ${cause instanceof Error ? cause.message : String(cause)}`);
    };

    const ended = new Set<string>();
    const asked = new Set<string>();
    api.events.subscribe((event) => {
      switch (event.kind) {
        case "run": {
          const message = runEndMessage(event.run.phase);
          if (message === undefined || ended.has(event.run.runId)) return;
          ended.add(event.run.runId);
          void notify(message).catch(report);
          return;
        }
        case "effect": {
          if (event.state !== "waiting" || asked.has(event.callId)) return;
          asked.add(event.callId);
          void notify("Input needs response", questionTitle(event.args)).catch(report);
          return;
        }
        default:
          return;
      }
    });
  },
});
