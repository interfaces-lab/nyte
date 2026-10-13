/** What the usage panel shows: the providers' account windows and what this chat has spent. */
import type { ModelCatalogView, SessionView, Usage } from "@nyte-ai/sdk";
import { formatTokens } from "./format.ts";
import { sessionUsage } from "./view-helpers.ts";

/** One provider's account windows, as it reported them on its last response. */
export interface AccountLimits {
  readonly provider: string;
  readonly name: string;
  readonly limits: ModelCatalogView["providers"][number]["limits"];
}

type ChatUsageCard =
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "usage"; readonly total: string; readonly breakdown: readonly string[] };

export interface UsageCard {
  readonly accounts: readonly AccountLimits[];
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

/** Returns the card for a chat's view and the catalog's account windows, when the catalog is read. */
export function usageCard(view: SessionView, catalog: ModelCatalogView | undefined): UsageCard {
  const accounts = (catalog?.providers ?? []).flatMap((provider) =>
    provider.limits.length === 0
      ? []
      : [{ provider: provider.id, name: provider.name, limits: provider.limits }],
  );

  const total = sessionUsage(view);

  if (total.total === 0 && total.cost.total === 0)
    return { accounts, chat: { kind: "message", message: "No usage recorded" } };

  return {
    accounts,
    chat: {
      kind: "usage",
      total: `${formatTokens(total.total)} tokens · ${formatCost(total.cost.total)}`,
      breakdown: breakdownLines(total),
    },
  };
}

const BAR_CELLS = 20;

/** The `/usage` panel's lines: each account window with its share and reset, then this chat's spend. */
export function usageLines(card: UsageCard): readonly string[] {
  const accounts = card.accounts.flatMap((account) => [
    `${account.name} · account limits`,
    ...account.limits.flatMap((window) => {
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
        `${window.label} · ${String(used)}% used · ${String(100 - used)}% left · ${reset}`,
        `${"━".repeat(fill)}${"─".repeat(BAR_CELLS - fill)}`,
        "",
      ];
    }),
  ]);

  const { chat } = card;

  return [
    "Recorded usage · API cost estimates, not subscription charges",
    "",
    ...accounts,
    ...(chat.kind === "message"
      ? [`this chat · ${chat.message}`]
      : [`this chat · ${chat.total}`, ...chat.breakdown]),
  ];
}
