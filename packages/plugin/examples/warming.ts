import type { Api, Model, Models } from "@nyte-ai/ai";
import type { RunPhase } from "@nyte-ai/core";
import { definePlugin, pluginFactKey } from "@nyte-ai/plugin";
import type { Message } from "@nyte-ai/schema";

export const WARMING_PLUGIN_ID = "warming";
export const WARMING_SETTING_ID = "warming";
const MODE_KEY = "mode";
const MODE_FACT = pluginFactKey(WARMING_PLUGIN_ID, MODE_KEY);
export const KEEP_ALIVE_PROMPT =
  "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK";
const DEFAULT_INTERVAL_MS = 4 * 60_000;
const DEFAULT_DURATION_MS = 30 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 8;

export interface WarmingOptions {
  readonly models: Pick<Models, "getModel" | "streamSimple">;
  /** Idle time before the first keep-alive and between later keep-alives. */
  readonly intervalMs?: number;
  /** How long after the last real request the chat stays warm. */
  readonly durationMs?: number;
  /** Maximum wall-clock time for one keep-alive provider request. */
  readonly requestTimeoutMs?: number;
  readonly now?: () => number;
}

interface Activity {
  /** Start of the current idle interval, or completion of the last keep-alive. */
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

function isBusyPhase(phase: RunPhase): boolean {
  switch (phase.kind) {
    case "respond":
    case "tools":
    case "retry":
      return true;
    case "waiting":
    case "done":
    case "aborted":
    case "failed":
      return false;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function warmingPlugin(options: WarmingOptions) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  return definePlugin({
    id: WARMING_PLUGIN_ID,
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

      let activity: Activity | undefined;
      let enabled: boolean | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let warming = false;
      let warmingController: AbortController | undefined;
      const busyRuns = new Set<string>();
      const warn = (cause: unknown): void => {
        if (api.signal.aborted) return;
        api.diagnostics.warn(`warming: ${cause instanceof Error ? cause.message : String(cause)}`);
      };
      const clearTimer = (): void => {
        clearTimeout(timer);
        timer = undefined;
      };
      const cancelWarming = (): void => {
        warmingController?.abort();
      };

      const schedule = (): void => {
        clearTimer();
        if (
          activity === undefined ||
          enabled === false ||
          busyRuns.size > 0 ||
          api.signal.aborted
        ) {
          return;
        }
        const at = nextWarmAt(activity, now(), intervalMs);
        if (at === undefined) return;
        timer = setTimeout(
          () => {
            timer = undefined;
            void warm().catch(warn);
          },
          Math.max(0, at - now()),
        );
        timer.unref?.();
      };

      const canWarm = (candidate: Activity): boolean =>
        activity === candidate &&
        enabled !== false &&
        busyRuns.size === 0 &&
        !api.signal.aborted &&
        now() < candidate.expires;

      const warm = async (): Promise<void> => {
        if (warming) return;
        const candidate = activity;
        if (candidate === undefined || !canWarm(candidate)) return;

        warming = true;
        let controller: AbortController | undefined;
        try {
          enabled = (await api.storage.get(MODE_KEY)) === "on";
          if (!canWarm(candidate)) return;
          const context = await api.session.context();
          if (!canWarm(candidate)) return;
          enabled = (await api.storage.get(MODE_KEY)) === "on";
          if (!canWarm(candidate)) return;

          const remainingMs = candidate.expires - now();
          if (remainingMs <= 0) return;
          controller = new AbortController();
          warmingController = controller;
          const timeout = AbortSignal.timeout(Math.min(requestTimeoutMs, remainingMs));
          const signal = AbortSignal.any([api.signal, controller.signal, timeout]);
          const keepAlive: Message = {
            role: "user",
            content: [{ type: "text", text: KEEP_ALIVE_PROMPT }],
            timestamp: now(),
          };
          const response = await options.models
            .streamSimple(
              candidate.model,
              {
                systemPrompt: context.systemPrompt,
                messages: [...context.messages, keepAlive],
                tools: [...api.tools.list()],
              },
              {
                maxTokens: MAX_OUTPUT_TOKENS,
                sessionId: candidate.sessionId,
                signal,
                timeoutMs: requestTimeoutMs,
                toolChoice: "none",
              },
            )
            .result();
          if (response.stopReason === "error" && !signal.aborted) {
            warn(response.errorMessage ?? "provider request failed");
          }
        } finally {
          warming = false;
          if (controller !== undefined && warmingController === controller) {
            warmingController = undefined;
          }
          if (activity === candidate && busyRuns.size === 0 && !api.signal.aborted) {
            activity = { ...candidate, at: now() };
          }
          schedule();
        }
      };

      const setRunBusy = (runId: string, busy: boolean): void => {
        const wasBusy = busyRuns.size > 0;
        if (busy) busyRuns.add(runId);
        else busyRuns.delete(runId);
        if (busyRuns.size > 0) {
          clearTimer();
          cancelWarming();
          return;
        }
        if (wasBusy && activity !== undefined) activity = { ...activity, at: now() };
        schedule();
      };

      api.events.subscribe((event) => {
        if (event.kind === "run") {
          setRunBusy(event.run.runId, isBusyPhase(event.run.phase));
          return;
        }
        if (event.kind !== "fact" || event.key !== MODE_FACT) return;
        enabled = event.value === "on";
        if (!enabled) {
          clearTimer();
          cancelWarming();
          return;
        }
        schedule();
      });

      api.hook("before_request", (event) => {
        setRunBusy(event.runId, true);
        const model = options.models.getModel(event.model.provider, event.model.modelId);
        if (model === undefined) {
          activity = undefined;
          return undefined;
        }
        const at = now();
        activity = { at, expires: at + durationMs, model, sessionId: event.sessionId };
        return undefined;
      });

      api.signal.addEventListener(
        "abort",
        () => {
          clearTimer();
          cancelWarming();
        },
        { once: true },
      );
    },
  });
}
