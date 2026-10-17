import { keycap } from "../lib/constants.ts";
import type { ChatCommand } from "../lib/constants.ts";
import type { PowerlineState } from "../lib/format.ts";
import { displayWidth } from "../lib/width.ts";
import type { Interactions } from "./interactions.ts";
import { followedSession } from "./state.ts";
import type { State } from "./state.ts";

export interface FooterModel {
  readonly powerline: Partial<PowerlineState>;
}

export interface Hint {
  readonly command: ChatCommand;
  readonly keycap: string;
  readonly label: string;
  readonly tier: "primary" | "secondary";
}

const HINT_ORDER: readonly { readonly command: ChatCommand; readonly tier: Hint["tier"] }[] = [
  { command: "completion.accept", tier: "primary" },
  { command: "completion.fill", tier: "primary" },
  { command: "completion.previous", tier: "primary" },
  { command: "completion.close", tier: "primary" },
  { command: "completion.next", tier: "secondary" },
  { command: "completion.page.up", tier: "secondary" },
  { command: "completion.page.down", tier: "secondary" },
  { command: "chat.submit", tier: "primary" },
  { command: "chat.queue.submit", tier: "secondary" },
  { command: "chat.interrupt", tier: "primary" },
  { command: "chat.quit", tier: "secondary" },
  { command: "chat.commands.open", tier: "primary" },
  { command: "chat.thinking.cycle", tier: "secondary" },
  { command: "chat.model.next", tier: "secondary" },
  { command: "chat.history.next", tier: "secondary" },
];

function basename(path: string): string {
  return path.replace(/\/+$/u, "").split("/").at(-1) ?? path;
}

export function footerFor(state: State, queued: number): FooterModel {
  const chat = state.facts.chat;
  const session = chat?.kind === "blank" && chat.unresolved === true ? null : chat;
  const view = followedSession(state)?.view ?? null;
  const { workspace } = state.facts;
  const context = view?.context;

  const badges = (view?.catalog.settings ?? []).flatMap((setting) => {
    const badge = setting.choices?.find(
      (choice) => JSON.stringify(choice.value) === JSON.stringify(setting.value),
    )?.badge;

    return badge === undefined ? [] : [badge];
  });

  return {
    powerline: {
      workspace: basename(workspace.cwd),
      branch: workspace.branch ?? undefined,
      dirty: workspace.dirty,
      provider: session?.selection.model.provider,
      model: session?.selection.model.id,
      effort: session?.selection.effort,
      statuses: badges,
      queued,
      tokens: context?.tokens ?? 0,
      window: context?.window ?? 0,
      pct:
        context === undefined || context.window <= 0
          ? 0
          : Math.round((context.tokens / context.window) * 100),
      remote: state.facts.remote,
    },
  };
}

function hintText(hint: Hint): string {
  return `${hint.keycap} ${hint.label}`;
}

/** The hints `hintsFor` last fitted, by the inputs they were fitted from. */
let fitted: { readonly key: string; readonly hints: readonly Hint[] } | null = null;

/**
 * The footer hints for these interactions at this width. Fitting measures every hint, and the
 * inputs rarely change between frames, so the last result is kept by what it was fitted from.
 */
export function hintsFor(interactions: Interactions, width: number): readonly Hint[] {
  const key = HINT_ORDER.reduce((built, { command }) => {
    const interaction = interactions[command];

    return interaction.intent === null || interaction.hidden
      ? `${built}\u0000`
      : `${built}\u0000${interaction.label}\u0001`;
  }, String(width));

  if (fitted?.key === key) return fitted.hints;
  const hints = fitHints(interactions, width);
  fitted = { key, hints };

  return hints;
}

function fitHints(interactions: Interactions, width: number): readonly Hint[] {
  const interruptShown =
    interactions["chat.interrupt"].intent !== null && !interactions["chat.interrupt"].hidden;

  const candidates = HINT_ORDER.flatMap(({ command, tier }): Hint[] => {
    const interaction = interactions[command];

    if (interaction.intent === null || interaction.hidden) return [];

    return [
      {
        command,
        keycap: keycap(command),
        label: interaction.label,
        tier: command === "chat.quit" && !interruptShown ? "primary" : tier,
      },
    ];
  });

  const shown = candidates.filter((hint) => hint.tier === "primary");

  for (const hint of candidates) {
    if (hint.tier === "primary") continue;
    const next = [...shown, hint];

    if (displayWidth(next.map(hintText).join(" · ")) <= width - 6) shown.push(hint);
  }

  return candidates.filter((hint) => shown.includes(hint));
}

export function sameHint(left: Hint, right: Hint): boolean {
  return left.command === right.command && left.label === right.label && left.tier === right.tier;
}
