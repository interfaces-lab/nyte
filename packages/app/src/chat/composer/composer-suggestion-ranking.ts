import type { MentionFile } from "../../data/files.ts";
import { createFileRanking } from "../../lib/file-ranking.ts";

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
  readonly recent?: true;
}

const CONVERSATION_SUGGESTION: MentionSuggestion = {
  kind: "mention",
  id: "current-conversation",
  label: "Current conversation",
  description: "Use this conversation as context",
  icon: "more",
};

function fileId(file: MentionFile): string {
  return `file:${file.path}`;
}

function fileSuggestion(file: MentionFile): FileSuggestion {
  return {
    kind: "file",
    id: fileId(file),
    label: file.label,
    description: file.displayPath,
    icon: file.kind,
    file,
  };
}

export function createMentionSuggestionRanking(files: readonly MentionFile[]) {
  const rankFiles = createFileRanking(files, MAX_FILE_SUGGESTIONS);
  let byId: ReadonlyMap<string, MentionFile> | undefined;

  return (
    rawQuery: string,
    hasConversationContext: boolean,
    recent: readonly string[],
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

    byId ??= new Map(files.map((file) => [fileId(file), file]));
    const known = byId;

    const used = recent
      .flatMap((id) => {
        const file = known.get(id);

        return file?.label.toLocaleLowerCase().includes(query) === true ? [file] : [];
      })
      .slice(0, MAX_FILE_SUGGESTIONS);

    const usedPaths = new Set(used.map((file) => file.path));
    const matches = query === "" ? files.slice(0, MAX_FILE_SUGGESTIONS) : rankFiles(query);

    const rest = matches
      .filter((file) => !usedPaths.has(file.path))
      .slice(0, MAX_FILE_SUGGESTIONS - used.length);

    return [
      ...results,
      ...used.map((file): FileSuggestion => ({ ...fileSuggestion(file), recent: true })),
      ...rest.map(fileSuggestion),
    ];
  };
}
