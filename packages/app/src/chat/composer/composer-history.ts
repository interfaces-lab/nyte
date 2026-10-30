import type { Head, MessageId, SessionView } from "@nyte-ai/sdk";
import { contentDraftText } from "../../references/message-references.ts";

const RECALLED_PROMPTS = 10;

const PROMPT_PAGE = 10;

export type RecallDirection = "older" | "newer";

/** Newest first. `before` is null once there is nothing older to read. */
export interface PromptHistory {
  readonly prompts: readonly string[];
  readonly before: MessageId | null;
}

type PromptPage = Pick<SessionView, "messages" | "leadingPrompt" | "turns">;

export function loadedPrompts(view: PromptPage | undefined): PromptHistory {
  return morePrompts(
    { prompts: [], before: null },
    view ?? { messages: [], leadingPrompt: null, turns: [] },
  );
}

/** Reads on before the prompt leading each page, so a long turn costs one read. */
export async function readPrompts(
  head: Pick<Head, "history">,
  history: PromptHistory,
  count: number,
): Promise<PromptHistory> {
  if (history.before === null || history.prompts.length >= count) return history;
  const page = await head.history({ before: history.before, limit: PROMPT_PAGE });

  return readPrompts(head, morePrompts(history, page), count);
}

/** `undefined` is the unsent draft. */
export function recallStep(
  count: number,
  position: number | undefined,
  direction: RecallDirection,
): number | undefined {
  if (direction === "newer")
    return position === undefined || position === 0 ? undefined : position - 1;

  if (count === 0) return undefined;

  return position === undefined ? 0 : Math.min(position + 1, count - 1);
}

/** Only turn prompts count, since a read skips the steers inside a turn it jumps over. */
function morePrompts(history: PromptHistory, page: PromptPage): PromptHistory {
  const leading = page.leadingPrompt;
  const turnPrompts = new Set(page.turns.map((turn) => turn.prompt));

  const earlier = (leading === null ? page.messages : [leading, ...page.messages]).flatMap(
    (message) => {
      if (message.kind !== "user" || message.source.kind !== "user" || !turnPrompts.has(message.id))
        return [];
      const prompt = contentDraftText(message.content);

      return prompt === "" ? [] : [prompt];
    },
  );

  const prompts = [...history.prompts, ...earlier.toReversed()].slice(0, RECALLED_PROMPTS);
  const first = leading ?? page.messages[0];

  return {
    prompts,
    before: prompts.length === RECALLED_PROMPTS || first === undefined ? null : first.id,
  };
}
