import { useState } from "react";
import type { Connection, Head, ModelInfo } from "@nyte-ai/sdk";
import { describeHostError } from "../connection/connection.ts";
import { openHead, type ComposerTarget } from "./composer-target.ts";
import { useModelCatalog } from "./remote-models.ts";
import { supportedThinkingLevel, thinkingLevelsFor, type ThinkingLevel } from "./thinking.ts";

export function useComposerModel(
  client: Connection,
  target: ComposerTarget,
  reportError: (message: string) => void,
) {
  const { catalog } = useModelCatalog(client);
  const [model, setModel] = useState<ModelInfo>();
  const [thinking, setThinking] = useState<ThinkingLevel>();
  const [selecting, setSelecting] = useState(false);
  const sessionModel = target.kind === "session" ? target.config?.model : undefined;
  const sessionThinking = target.kind === "session" ? target.config?.thinking : undefined;

  const catalogModel =
    sessionModel === undefined || catalog.kind !== "ready"
      ? undefined
      : catalog.models.find(
          (item) => item.ref.id === sessionModel.id && item.ref.provider === sessionModel.provider,
        );

  const chosenModel =
    model ?? catalogModel ?? (catalog.kind === "ready" ? catalog.defaultModel : undefined);

  const chosenThinking = supportedThinkingLevel(chosenModel, thinking ?? sessionThinking);

  const catalogModelKey =
    catalogModel === undefined ? undefined : `${catalogModel.ref.provider}:${catalogModel.ref.id}`;

  const [seenModelKey, setSeenModelKey] = useState(catalogModelKey);

  if (seenModelKey !== catalogModelKey) {
    setSeenModelKey(catalogModelKey);

    if (catalogModel !== undefined) setModel(catalogModel);
  }

  const [seenThinking, setSeenThinking] = useState(sessionThinking);

  if (seenThinking !== sessionThinking) {
    setSeenThinking(sessionThinking);

    if (sessionThinking !== undefined) setThinking(sessionThinking);
  }

  const configure = async (
    head: Head,
    next: { model?: ModelInfo; thinking?: ThinkingLevel },
  ): Promise<boolean> => {
    try {
      const outcome = await head.configure({ model: next.model?.ref, thinking: next.thinking });

      switch (outcome.kind) {
        case "configured":
          return true;
        case "unknown-model":
          reportError("The host doesn't offer that model.");

          return false;
        case "unknown-agent":
          reportError("The host doesn't offer that agent.");

          return false;
        case "invalid":
          reportError(outcome.issues[0]?.message ?? "The host refused that choice.");

          return false;
        default: {
          const exhaustive: never = outcome;

          return exhaustive;
        }
      }
    } catch (cause: unknown) {
      reportError(describeHostError(cause));

      return false;
    }
  };

  const chooseModel = async (choice: ModelInfo): Promise<boolean> => {
    setModel(choice);
    setThinking(choice.defaultThinking);

    if (target.kind !== "session") return true;

    setSelecting(true);

    const applied = await configure(openHead(client, target), {
      model: choice,
      thinking: choice.defaultThinking,
    });

    setSelecting(false);

    if (!applied) {
      setModel(catalogModel);
      setThinking(sessionThinking);
    }

    return applied;
  };

  const chooseThinking = (choice: ThinkingLevel) => {
    setThinking(choice);

    if (target.kind !== "session") return;
    void configure(openHead(client, target), { thinking: choice }).then((applied) => {
      if (!applied) setThinking(sessionThinking);
    });
  };

  return {
    chosenModel,
    chosenThinking,
    thinkingStops: thinkingLevelsFor(chosenModel),
    start: { model: model?.ref, thinking },
    selecting,
    chooseModel,
    chooseThinking,
  };
}

export type ComposerModel = ReturnType<typeof useComposerModel>;
