/**
 * Prompt history for Up/Down: the user's own landed messages, oldest first,
 * as drafts with their markers rebuilt. Reports and action prompts are not
 * the user's words, so they never come back.
 */
import type { SessionView } from "@nyte-ai/sdk";
import { isReport } from "../lib/view-helpers.ts";
import { draftFromContent } from "./draft.ts";
import type { DraftSnapshot } from "./draft.ts";

const MAX_HISTORY = 100;

export function promptEntries(view: SessionView | null): readonly DraftSnapshot[] {
  if (view === null) return [];

  return view.messages
    .flatMap((message) => {
      if (message.kind !== "user" || message.status.kind !== "landed") return [];

      if (isReport(message) || message.source.kind === "action") return [];
      const draft = draftFromContent(message.content);

      return draft.text.trim() === "" ? [] : [draft];
    })
    .slice(-MAX_HISTORY);
}
