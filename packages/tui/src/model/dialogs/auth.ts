import type { DialogCommand, DialogId, DialogStep } from "./dialog.ts";

export interface AuthDialog {
  readonly kind: "auth";
  readonly id: DialogId;
  readonly mode: "login" | "logout";
  readonly provider: string;
  readonly name: string;
  readonly link: AuthLink | null;
  readonly step: AuthStep;
  readonly promptVersion?: number;
}

export interface AuthLink {
  readonly url: string;
  readonly code: string | null;
}

export type AuthPrompt =
  | { readonly kind: "link"; readonly url: string; readonly code: string | null }
  | { readonly kind: "secret"; readonly prompt: string; readonly masked: boolean }
  | {
      readonly kind: "choose";
      readonly prompt: string;
      readonly options: readonly { readonly id: string; readonly label: string }[];
    }
  | { readonly kind: "waiting"; readonly message: string };

export type AuthStep =
  | { readonly kind: "starting" }
  | { readonly kind: "link"; readonly url: string; readonly code: string | null }
  | {
      readonly kind: "secret";
      readonly prompt: string;
      readonly masked: boolean;
      readonly codePoints: readonly number[];
      readonly caret?: number;
      readonly anchor?: number;
    }
  | {
      readonly kind: "choose";
      readonly prompt: string;
      readonly options: readonly { readonly id: string; readonly label: string }[];
      readonly highlighted: number;
    }
  | { readonly kind: "waiting"; readonly message: string };

const WAITING: AuthStep = { kind: "waiting", message: "Waiting for the provider…" };

export function withPrompt(dialog: AuthDialog, prompt: AuthPrompt): AuthDialog {
  const next = { ...dialog, promptVersion: (dialog.promptVersion ?? 0) + 1 };

  switch (prompt.kind) {
    case "secret":
      return { ...next, step: { ...prompt, codePoints: [] } };
    case "choose":
      return { ...next, step: { ...prompt, highlighted: 0 } };
    case "link":
      return { ...next, link: { url: prompt.url, code: prompt.code }, step: prompt };
    default:
      return { ...next, step: prompt };
  }
}

function unchanged(dialog: AuthDialog): DialogStep<AuthDialog> {
  return { dialog, intents: [], push: null };
}

function answer(dialog: AuthDialog, text: string): DialogStep<AuthDialog> {
  return {
    dialog: { ...dialog, step: WAITING },
    intents: [{ kind: "auth-answer", dialog: dialog.id, answer: text }],
    push: null,
  };
}

export function reduceAuth(dialog: AuthDialog, command: DialogCommand): DialogStep<AuthDialog> {
  const cancel: DialogStep<AuthDialog> = { dialog, intents: [{ kind: "cancel-auth" }], push: null };

  if (command.kind === "close") return cancel;
  const { step } = dialog;

  if (command.kind === "query") {
    if (step.kind !== "secret") return unchanged(dialog);

    return unchanged({
      ...dialog,
      step: {
        ...step,
        codePoints: Array.from(command.text, (character) => character.codePointAt(0) ?? 0),
      },
    });
  }

  if (command.kind === "highlight") return unchanged(dialog);

  if (command.kind === "pick") {
    if (step.kind !== "choose") return unchanged(dialog);
    const option = step.options[command.index];

    return option === undefined ? unchanged(dialog) : answer(dialog, option.id);
  }

  if (command.name === "auth.cancel" || command.name === "picker.close") return cancel;
  const submit = command.name === "auth.submit" || command.name === "picker.accept";

  switch (step.kind) {
    case "starting":
    case "waiting":
      return unchanged(dialog);
    case "link":
      if (submit || command.name === "auth.open")
        return { dialog, intents: [{ kind: "open-external", target: step.url }], push: null };

      if (command.name === "auth.copy")
        return {
          dialog,
          intents: [{ kind: "copy-text", text: step.code ?? step.url }],
          push: null,
        };

      return unchanged(dialog);
    case "secret":
      if (!submit) return unchanged(dialog);

      return answer(dialog, String.fromCodePoint(...step.codePoints));
    case "choose": {
      const count = step.options.length;

      if (submit) {
        const option = step.options[step.highlighted];

        return option === undefined ? unchanged(dialog) : answer(dialog, option.id);
      }

      if (count === 0) return unchanged(dialog);

      if (command.name === "picker.previous")
        return unchanged({
          ...dialog,
          step: { ...step, highlighted: (step.highlighted - 1 + count) % count },
        });

      if (command.name === "picker.next")
        return unchanged({
          ...dialog,
          step: { ...step, highlighted: (step.highlighted + 1) % count },
        });

      return unchanged(dialog);
    }

    default: {
      const _exhaustive: never = step;

      return _exhaustive;
    }
  }
}
