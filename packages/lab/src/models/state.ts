import { useState } from "react";
import type { ModelListing, Thinking } from "@nyte-ai/sdk";
import type { DesktopCatalog, DesktopModelOption } from "@nyte-ai/app/data/catalog.ts";
import {
  supportedThinkingLevel,
  thinkingLevelsFor,
} from "@nyte-ai/app/chat/composer/model-picker-state.ts";
import { catalog } from "./fixtures";

function findModel(models: readonly DesktopModelOption[], key: string): DesktopModelOption {
  const found = models.find((option) => option.key === key) ?? models[0];

  if (found === undefined) throw new Error("The lab catalog has no models");

  return found;
}

const START = "anthropic/claude-opus-4-5";

/** One chat's model, reasoning and Fast, the three things every take edits. */
export function useChoice(start: string = START) {
  const [state, setState] = useState<{
    readonly key: string;
    readonly thinking: Thinking | undefined;
    readonly fast: boolean;
  }>({ key: start, thinking: "high", fast: false });

  const current = findModel(catalog.models, state.key);
  const levels = thinkingLevelsFor(current);

  return {
    current,
    levels,
    thinking: supportedThinkingLevel(current, state.thinking),
    reasons: levels.length > 1,
    fastAvailable: current.fastMode.kind === "available",
    fast: current.fastMode.kind === "available" && state.fast,
    pick: (option: DesktopModelOption) =>
      setState({ key: option.key, thinking: option.defaultThinking, fast: false }),
    setThinking: (thinking: Thinking) => setState((previous) => ({ ...previous, thinking })),
    setFast: (fast: boolean) => setState((previous) => ({ ...previous, fast })),
  };
}

export type Choice = ReturnType<typeof useChoice>;

/** The catalog with local star and hide edits, as settings would save them. */
export function useListings() {
  const [edits, setEdits] = useState<ReadonlyMap<string, ModelListing>>(new Map());

  const models = catalog.models.map((option) => {
    const listing = edits.get(option.key) ?? option.listing;

    const connected = catalog.providers.some(
      (provider) => provider.id === option.provider && provider.credential !== "missing",
    );

    return { ...option, listing, listed: connected && listing !== "hidden" };
  });

  return {
    catalog: { ...catalog, models } satisfies DesktopCatalog,
    setListing: (keys: readonly string[], listing: ModelListing) =>
      setEdits((previous) => new Map([...previous, ...keys.map((key) => [key, listing] as const)])),
  };
}

export function compactTokens(tokens: number): string {
  return tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(1))}M`
    : `${Math.round(tokens / 1_000)}K`;
}
