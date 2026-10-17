/**
 * ChatGPT subscription windows for the Codex provider: read from `wham/usage`, from the
 * `x-codex-*` headers on every SSE response, and from `codex.rate_limits` WebSocket frames.
 */
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  buildBaseCodexHeaders,
  type CodexFrame,
  DEFAULT_CODEX_BASE_URL,
  extractAccountId,
} from "../api/openai-codex-wire.ts";
import type {
  AccountLimitWindow,
  AccountLimits,
  AccountLimitsFetchOptions,
  AccountLimitsTarget,
} from "../types.ts";
import { fetchAccountUsage, limitWindow } from "./account-limits.ts";

const OptionalJsonNumber = Type.Optional(Type.Union([Type.Number(), Type.Null()]));

const CodexUsageWindowSchema = Type.Object({
  used_percent: Type.Number(),
  limit_window_seconds: OptionalJsonNumber,
  reset_at: OptionalJsonNumber,
});

const CodexUsageResponseSchema = Type.Object({
  rate_limit: Type.Optional(
    Type.Union([
      Type.Object({
        primary_window: Type.Optional(Type.Unknown()),
        secondary_window: Type.Optional(Type.Unknown()),
      }),
      Type.Null(),
    ]),
  ),
});

const CodexPlanSchema = Type.Object({ plan_type: Type.String() });

/** The `codex.rate_limits` WebSocket frame: windows in minutes, the plan beside them. */
const CodexRateLimitsFrameSchema = Type.Object({
  type: Type.Literal("codex.rate_limits"),
  plan_type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  rate_limits: Type.Optional(
    Type.Union([
      Type.Object({
        primary: Type.Optional(Type.Unknown()),
        secondary: Type.Optional(Type.Unknown()),
      }),
      Type.Null(),
    ]),
  ),
});

const CodexRateLimitWindowSchema = Type.Object({
  used_percent: Type.Number(),
  window_minutes: OptionalJsonNumber,
  reset_at: OptionalJsonNumber,
});

const FIVE_HOURS_SECONDS = 5 * 60 * 60;

const WEEK_SECONDS = 7 * 24 * 60 * 60;

function durationLabel(seconds: number): string {
  if (seconds === WEEK_SECONDS) return "Weekly";

  if (seconds % (24 * 60 * 60) === 0) return `${String(seconds / (24 * 60 * 60))}-day`;

  if (seconds % (60 * 60) === 0) return `${String(seconds / (60 * 60))}-hour`;

  return `${String(Math.round(seconds / 60))}-minute`;
}

/** A Codex window named by its length; reset times arrive in seconds. */
function codexLimitWindow(
  fallbackId: "primary" | "secondary",
  usedPercent: number,
  windowSeconds: number | null | undefined,
  resetAtSeconds: number | null | undefined,
): AccountLimitWindow {
  const id =
    windowSeconds === FIVE_HOURS_SECONDS
      ? "five_hour"
      : windowSeconds === WEEK_SECONDS
        ? "seven_day"
        : fallbackId;
  const label =
    windowSeconds === undefined || windowSeconds === null
      ? fallbackId === "primary"
        ? "Primary"
        : "Secondary"
      : durationLabel(windowSeconds);

  return limitWindow(
    id,
    label,
    usedPercent,
    resetAtSeconds === undefined || resetAtSeconds === null ? undefined : resetAtSeconds * 1000,
    windowSeconds === undefined || windowSeconds === null ? undefined : windowSeconds / 60,
  );
}

/** A minutes-based window; one the plan does not have arrives as zero minutes and is dropped. */
function minutesWindow(
  fallbackId: "primary" | "secondary",
  window: Static<typeof CodexRateLimitWindowSchema>,
): AccountLimitWindow | undefined {
  if (!window.window_minutes) return undefined;

  return codexLimitWindow(
    fallbackId,
    window.used_percent,
    window.window_minutes * 60,
    window.reset_at,
  );
}

function accountLimits(
  providerId: string,
  windows: AccountLimitWindow[],
  plan: string | null | undefined,
): AccountLimits | undefined {
  if (windows.length === 0) return undefined;
  const limits: AccountLimits = { providerId, windows, observedAt: Date.now() };

  if (plan) limits.plan = plan;

  return limits;
}

/** Windows from a `codex.rate_limits` frame, or undefined for any other frame. */
export function codexFrameLimits(frame: CodexFrame, providerId: string): AccountLimits | undefined {
  if (!Value.Check(CodexRateLimitsFrameSchema, frame)) return undefined;
  const windows: AccountLimitWindow[] = [];

  for (const id of ["primary", "secondary"] as const) {
    const window = frame.rate_limits?.[id];
    const parsed = Value.Check(CodexRateLimitWindowSchema, window)
      ? minutesWindow(id, window)
      : undefined;

    if (parsed !== undefined) windows.push(parsed);
  }

  return accountLimits(providerId, windows, frame.plan_type);
}

/** Every SSE response carries the same windows as `x-codex-{primary,secondary}-*` headers. */
export function codexHeaderLimits(
  headers: Record<string, string>,
  providerId: string,
): AccountLimits | undefined {
  const windows: AccountLimitWindow[] = [];

  for (const id of ["primary", "secondary"] as const) {
    const usedPercent = Number(headers[`x-codex-${id}-used-percent`]);

    if (!Number.isFinite(usedPercent)) continue;
    const resetHeader = headers[`x-codex-${id}-reset-at`];
    const resetAt = resetHeader ? Number(resetHeader) : Number.NaN;
    const parsed = minutesWindow(id, {
      used_percent: usedPercent,
      window_minutes: Number(headers[`x-codex-${id}-window-minutes`]),
      reset_at: Number.isFinite(resetAt) ? resetAt : null,
    });

    if (parsed !== undefined) windows.push(parsed);
  }

  return accountLimits(providerId, windows, headers["x-codex-plan-type"]);
}

/** Fetch current ChatGPT subscription windows from `wham/usage`. */
export async function fetchOpenAICodexAccountLimits(
  model: AccountLimitsTarget,
  options?: AccountLimitsFetchOptions,
): Promise<AccountLimits> {
  const apiKey = options?.apiKey;

  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
  const headers = buildBaseCodexHeaders(
    model.headers,
    options?.headers,
    extractAccountId(apiKey),
    apiKey,
  );
  headers.set("accept", "application/json");
  const baseUrl = (model.baseUrl?.trim() || DEFAULT_CODEX_BASE_URL)
    .replace(/\/+$/, "")
    .replace(/\/codex$/, "");
  const decoded = await fetchAccountUsage(
    `${baseUrl}/wham/usage`,
    headers,
    options,
    CodexUsageResponseSchema,
    "Codex",
  );
  const windows: AccountLimitWindow[] = [];

  for (const [id, window] of [
    ["primary", decoded.rate_limit?.primary_window],
    ["secondary", decoded.rate_limit?.secondary_window],
  ] as const) {
    if (!Value.Check(CodexUsageWindowSchema, window)) continue;
    windows.push(
      codexLimitWindow(id, window.used_percent, window.limit_window_seconds, window.reset_at),
    );
  }

  const limits: AccountLimits = { providerId: model.provider, windows, observedAt: Date.now() };

  if (Value.Check(CodexPlanSchema, decoded)) limits.plan = decoded.plan_type;

  return limits;
}
