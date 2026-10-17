/**
 * Claude subscription windows for the Anthropic provider: read from the OAuth
 * usage endpoint and from the unified rate-limit headers on every OAuth response.
 */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type {
  AccountLimitWindow,
  AccountLimits,
  AccountLimitsFetchOptions,
  AccountLimitsTarget,
} from "../types.ts";
import { claudeCodeVersion, usesClaudeSubscription } from "../api/claude-code.ts";
import { fetchAccountUsage, limitWindow } from "./account-limits.ts";

const AccountResetSchema = Type.Optional(Type.Union([Type.Number(), Type.String(), Type.Null()]));

const ClaudeUsageResponseSchema = Type.Record(Type.String(), Type.Unknown());

const ClaudeUsageWindowSchema = Type.Object({
  utilization: Type.Number(),
  resets_at: AccountResetSchema,
});

/** Newer Claude responses place model-specific weekly limits in a scoped array. */
const ClaudeScopedUsageWindowSchema = Type.Object({
  kind: Type.Literal("weekly_scoped"),
  scope: Type.Object({ model: Type.Object({ display_name: Type.String() }) }),
  percent: Type.Number(),
  resets_at: AccountResetSchema,
});

/** A reset given in seconds, milliseconds, or as a date string, in milliseconds. */
function resetAtMs(value: Static<typeof AccountResetSchema> | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "number") {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function accountLimitWindow(
  id: string,
  label: string,
  percent: number,
  reset: Static<typeof AccountResetSchema> | undefined,
  windowMinutes: number,
): AccountLimitWindow {
  return limitWindow(id, label, percent, resetAtMs(reset), windowMinutes);
}

const CLAUDE_USAGE_WINDOWS = [
  { id: "five_hour", label: "5-hour", windowMinutes: 5 * 60 },
  { id: "seven_day", label: "Weekly", windowMinutes: 7 * 24 * 60 },
  { id: "seven_day_sonnet", label: "Sonnet weekly", windowMinutes: 7 * 24 * 60 },
  { id: "seven_day_opus", label: "Opus weekly", windowMinutes: 7 * 24 * 60 },
] as const;

/**
 * Every OAuth response carries the shared windows as
 * `anthropic-ratelimit-unified-{5h,7d}-{utilization,reset}`, so a turn that
 * just ran is also the freshest read of the account.
 */
export function claudeHeaderLimits(
  headers: Record<string, string>,
  providerId: string,
): AccountLimits | undefined {
  const windows: AccountLimitWindow[] = [];

  for (const [id, label, suffix, windowMinutes] of [
    ["five_hour", "5-hour", "5h", 5 * 60],
    ["seven_day", "Weekly", "7d", 7 * 24 * 60],
  ] as const) {
    const utilization = Number(headers[`anthropic-ratelimit-unified-${suffix}-utilization`]);

    if (!Number.isFinite(utilization)) continue;
    const reset = Number(headers[`anthropic-ratelimit-unified-${suffix}-reset`]);

    windows.push(
      accountLimitWindow(
        id,
        label,
        utilization * 100,
        Number.isFinite(reset) ? reset : undefined,
        windowMinutes,
      ),
    );
  }

  return windows.length === 0 ? undefined : { providerId, windows, observedAt: Date.now() };
}

function claudeUsageWindows(usage: Static<typeof ClaudeUsageResponseSchema>): AccountLimitWindow[] {
  const windows: AccountLimitWindow[] = [];

  for (const definition of CLAUDE_USAGE_WINDOWS) {
    const window = usage[definition.id];

    if (!Value.Check(ClaudeUsageWindowSchema, window)) continue;
    windows.push(
      accountLimitWindow(
        definition.id,
        definition.label,
        window.utilization,
        window.resets_at,
        definition.windowMinutes,
      ),
    );
  }

  const scoped = usage["limits"];

  for (const window of Array.isArray(scoped) ? scoped : []) {
    if (!Value.Check(ClaudeScopedUsageWindowSchema, window)) continue;
    const name = window.scope.model.display_name;

    if (name.trim() === "") continue;
    windows.push(
      accountLimitWindow(
        `seven_day_${name}`,
        `${name} weekly`,
        window.percent,
        window.resets_at,
        7 * 24 * 60,
      ),
    );
  }

  return windows;
}

/** Fetch Claude Code subscription windows from Anthropic's OAuth usage endpoint. */
export async function fetchAnthropicAccountLimits(
  model: AccountLimitsTarget,
  options?: AccountLimitsFetchOptions,
): Promise<AccountLimits> {
  const apiKey = options?.apiKey;

  if (!apiKey || !usesClaudeSubscription(apiKey)) {
    throw new Error("Claude usage requires Anthropic OAuth");
  }

  const headers = new Headers({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": `claude-cli/${claudeCodeVersion}`,
    "anthropic-beta": "oauth-2025-04-20",
  });

  for (const source of [model.headers, options?.headers]) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
  }

  const baseUrl = (model.baseUrl?.trim() || "https://api.anthropic.com")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  const decoded = await fetchAccountUsage(
    `${baseUrl}/api/oauth/usage`,
    headers,
    options,
    ClaudeUsageResponseSchema,
    "Claude",
  );

  return {
    providerId: model.provider,
    windows: claudeUsageWindows(decoded),
    observedAt: Date.now(),
  };
}
