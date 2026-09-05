/**
 * Keeps the provider's cached prefix warm after a turn: every few minutes,
 * for a while after the last request, the chat's own context is sent again
 * with a one-word question and the same tools, so the next real request
 * still hits the cache. Off unless the `warming` setting says otherwise.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/warming.ts
 */
import type { Api, Model, Models } from "@nyte-ai/ai";
import { definePlugin } from "@nyte-ai/plugin";
import type { Message } from "@nyte-ai/schema";

export const WARMING_SETTING_ID = "warming";
const MODE_KEY = "mode";
export const KEEP_ALIVE_PROMPT =
  "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK";
const DEFAULT_INTERVAL_MS = 4 * 60_000;
const DEFAULT_DURATION_MS = 30 * 60_000;
const MAX_OUTPUT_TOKENS = 8;

export interface WarmingOptions {
  readonly models: Pick<Models, "getModel" | "streamSimple">;
  /** Time between keep-alive requests. */
  readonly intervalMs?: number;
  /** How long after the last real request the chat stays warm. */
  readonly durationMs?: number;
  readonly now?: () => number;
}

interface Activity {
  /** The last request of any kind, including a keep-alive. */
  readonly at: number;
  /** One duration after the last real request; keep-alives do not extend it. */
  readonly expires: number;
  readonly model: Model<Api>;
  readonly sessionId: string;
}

/** When the next keep-alive is due, or nothing once the chat has gone cold. */
export function nextWarmAt(
  activity: Pick<Activity, "at" | "expires">,
  now: number,
  intervalMs: number,
): number | undefined {
  if (now >= activity.expires) return undefined;
  const next = Math.max(now, activity.at + intervalMs);
  return next >= activity.expires ? undefined : next;
}

export function warmingPlugin(options: WarmingOptions) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const now = options.now ?? Date.now;
  return definePlugin({
    id: "warming",
    session(api) {
      api.settings.add((draft) => {
        draft.set(WARMING_SETTING_ID, {
          label: "Keep the cache warm",
          key: MODE_KEY,
          fallback: "off",
          choices: [
            { id: "off", label: "off" },
            {
              id: "on",
              label: "on",
              description: "Resend the context every few minutes after a turn",
              status: "warm",
            },
          ],
        });
      });

      let last: Activity | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const warn = (cause: unknown): void => {
        api.diagnostics.warn(`warming: ${cause instanceof Error ? cause.message : String(cause)}`);
      };

      const schedule = (): void => {
        clearTimeout(timer);
        if (last === undefined) return;
        const at = nextWarmAt(last, now(), intervalMs);
        if (at === undefined) return;
        timer = setTimeout(() => void warm().catch(warn), Math.max(0, at - now()));
        timer.unref?.();
      };

      /** One request over the real context; the answer is thrown away. */
      const warm = async (): Promise<void> => {
        const activity = last;
        if (activity === undefined) return;
        if ((await api.storage.get(MODE_KEY)) !== "on") return;
        const context = await api.session.context();
        const keepAlive: Message = {
          role: "user",
          content: [{ type: "text", text: KEEP_ALIVE_PROMPT }],
          timestamp: now(),
        };
        await options.models
          .streamSimple(
            activity.model,
            {
              systemPrompt: context.systemPrompt,
              messages: [...context.messages, keepAlive],
              tools: [...api.tools.list()],
            },
            { maxTokens: MAX_OUTPUT_TOKENS, sessionId: activity.sessionId },
          )
          .result();
        // A keep-alive spaces the next one but never extends how long the chat stays warm.
        if (last === activity) last = { ...activity, at: now() };
        schedule();
      };

      api.hook("before_request", (event) => {
        if (event.step !== "assistant") return undefined;
        const model = options.models.getModel(event.model.provider, event.model.modelId);
        if (model !== undefined) {
          const at = now();
          last = { at, expires: at + durationMs, model, sessionId: event.sessionId };
          schedule();
        }
        return undefined;
      });
    },
  });
}
