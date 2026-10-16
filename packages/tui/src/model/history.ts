import type { SessionView } from "@nyte-ai/sdk";
import { showsReport } from "@nyte-ai/plugin/client/presentation";
import { draftFromContent } from "./draft.ts";
import type { DraftSnapshot } from "./draft.ts";

const MAX_HISTORY = 100;

export function promptEntries(view: SessionView | null): readonly DraftSnapshot[] {
  if (view === null) return [];

  return view.messages
    .flatMap((message) => {
      if (message.kind !== "user" || message.status.kind !== "landed") return [];

      if (showsReport(message) || message.source.kind === "action") return [];
      const draft = draftFromContent(message.content);

      return draft.text.trim() === "" ? [] : [draft];
    })
    .slice(-MAX_HISTORY);
}
