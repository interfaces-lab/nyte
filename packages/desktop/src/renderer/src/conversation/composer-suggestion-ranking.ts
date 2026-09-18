import type { MentionFile } from "@nyte-ai/client";
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

interface SearchableFile {
  readonly file: MentionFile;
  readonly label: string;
  readonly description: string;
}

/** One catalog owns one lazy index, not a growing cache of queries or catalogs. */
export function createMentionSuggestionRanking(files: readonly MentionFile[]) {
  let searchable: readonly SearchableFile[] | undefined;
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
    if (query === "") {
      return [...results, ...files.slice(0, MAX_FILE_SUGGESTIONS).map(fileSuggestion)];
    }
    searchable ??= files.map((file) => ({
      file,
      label: file.label.toLocaleLowerCase(),
      description: file.displayPath.toLocaleLowerCase(),
    }));
    const prefixes: MentionFile[] = [];
    const substrings: MentionFile[] = [];
    const descriptions: MentionFile[] = [];
    for (const entry of searchable) {
      const bucket = entry.label.startsWith(query)
        ? prefixes
        : entry.label.includes(query)
          ? substrings
          : entry.description.includes(query)
            ? descriptions
            : undefined;
      if (bucket !== undefined && bucket.length < MAX_FILE_SUGGESTIONS) {
        bucket.push(entry.file);
      }
      // Later entries cannot outrank or precede these prefix matches.
      if (prefixes.length === MAX_FILE_SUGGESTIONS) break;
    }
    const contextCount = results.length;
    for (const bucket of [prefixes, substrings, descriptions]) {
      for (const file of bucket) {
        if (results.length - contextCount === MAX_FILE_SUGGESTIONS) return results;
        results.push(fileSuggestion(file));
      }
    }
    return results;
  };
}
