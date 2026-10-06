import type { MentionFile } from "@nyte-ai/client";
import { createFileRanking } from "../file-ranking.ts";
import { isFolder } from "./message-references.ts";

/** The context entry does not count toward the workspace result limit. */
const MAX_FILE_SUGGESTIONS = 20;

export interface MentionSuggestion {
  readonly kind: "mention";
  readonly id: "current-conversation";
  readonly label: "Current conversation";
  readonly description: "Use this conversation as context";
  readonly icon: "more";
}

export interface FileSuggestion {
  readonly kind: "file";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "file" | "folder";
  readonly file: MentionFile;
}

const CONVERSATION_SUGGESTION: MentionSuggestion = {
  kind: "mention",
  id: "current-conversation",
  label: "Current conversation",
  description: "Use this conversation as context",
  icon: "more",
};

function fileSuggestion(file: MentionFile): FileSuggestion {
  return {
    kind: "file",
    id: `file:${file.path}`,
    label: file.label,
    description: file.displayPath,
    icon: isFolder(file) ? "folder" : "file",
    file,
  };
}

/** One catalog owns one lazy index, not a growing cache of queries or catalogs. */
export function createMentionSuggestionRanking(files: readonly MentionFile[]) {
  const rankFiles = createFileRanking(files, MAX_FILE_SUGGESTIONS);

  return (
    rawQuery: string,
    hasConversationContext: boolean,
  ): readonly (FileSuggestion | MentionSuggestion)[] => {
    const query = rawQuery.trim().toLocaleLowerCase();
    const results: (FileSuggestion | MentionSuggestion)[] = [];

    if (
      hasConversationContext &&
      (CONVERSATION_SUGGESTION.label.toLocaleLowerCase().includes(query) ||
        CONVERSATION_SUGGESTION.description.toLocaleLowerCase().includes(query))
    ) {
      results.push(CONVERSATION_SUGGESTION);
    }

    const matches = query === "" ? files.slice(0, MAX_FILE_SUGGESTIONS) : rankFiles(query);

    return [...results, ...matches.map(fileSuggestion)];
  };
}
