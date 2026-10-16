import type { ProviderUsage, SessionView, Usage } from "@nyte-ai/sdk";
import type { TextLine } from "../model/dialogs/dialog.ts";
import { GLYPHS } from "./constants.ts";
import { formatTokens } from "./format.ts";

type ChatUsageCard =
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "usage"; readonly total: string; readonly breakdown: readonly string[] };

interface UsageCard {
  readonly accounts: readonly ProviderUsage[];
  readonly chat: ChatUsageCard;
}

function formatCost(cost: number): string {
  if (cost === 0 || cost >= 0.01) return `$${cost.toFixed(2)}`;

  return `$${cost.toFixed(4)}`;
}

function breakdownLines(total: Usage): readonly string[] {
  const primary = `input ${formatTokens(total.input)} · output ${formatTokens(total.output)}`;
  const cache: string[] = [];

  if (total.cacheRead > 0) cache.push(`cache read ${formatTokens(total.cacheRead)}`);

  if (total.cacheWrite > 0) cache.push(`cache write ${formatTokens(total.cacheWrite)}`);

  return cache.length === 0 ? [primary] : [primary, cache.join(" · ")];
}

export function usageCard(view: SessionView, accounts: readonly ProviderUsage[]): UsageCard {
  const total = view.usage;

  if (total.total === 0 && total.cost.total === 0)
    return { accounts, chat: { kind: "message", message: "No usage recorded" } };

  return {
    accounts,
    chat: {
      kind: "usage",
      total: `${formatTokens(total.total)} tokens · ${formatCost(total.cost.total)} estimated API cost`,
      breakdown: breakdownLines(total),
    },
  };
}

const BAR_CELLS = 20;

const WARNING_SHARE = 85;

const ERROR_SHARE = 95;

export function usageLines(card: UsageCard): readonly TextLine[] {
  const accounts = card.accounts.flatMap((provider): TextLine[] => {
    const { state } = provider;

    const name =
      provider.account === null ? provider.name : `${provider.name} · ${provider.account.label}`;

    if (state.kind === "unavailable")
      return state.reason === "failed"
        ? [[{ text: `${name} · ${state.message}`, tone: "error" }], ""]
        : [];

    return [
      [{ text: `${name} · account limits`, bold: true }],
      ...(state.stale
        ? [
            [
              {
                text: `Cached limits${state.error === null ? "" : ` · ${state.error}`}`,
                tone: "warning" as const,
              },
            ],
          ]
        : []),
      ...state.limits.flatMap((window): TextLine[] => {
        const used = window.limit <= 0 ? 0 : Math.round((window.used / window.limit) * 100);

        const fill =
          used <= 0 ? 0 : Math.max(1, Math.min(BAR_CELLS, Math.round((used / 100) * BAR_CELLS)));

        const reset =
          window.resetsAt === null
            ? "reset unknown"
            : `resets ${new Date(window.resetsAt).toLocaleString(undefined, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}`;

        return [
          `${window.label} · ${String(used)}% used · ${String(Math.max(0, 100 - used))}% left · ${reset}`,
          [
            {
              text: "━".repeat(fill),
              tone: used >= ERROR_SHARE ? "error" : used >= WARNING_SHARE ? "warning" : "accent",
            },
            { text: GLYPHS.rule.repeat(BAR_CELLS - fill), tone: "muted" },
          ],
        ];
      }),
      "",
    ];
  });

  const { chat } = card;

  return [
    ...accounts,
    ...(chat.kind === "message"
      ? [[{ text: `this chat · ${chat.message}`, bold: true }]]
      : [[{ text: `this chat · ${chat.total}`, bold: true }], ...chat.breakdown]),
  ];
}
