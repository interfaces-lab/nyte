import { mentionFile } from "../../data/files.ts";
import type { MentionFile } from "../../data/files.ts";

const MAX_FILE_SUGGESTIONS = 20;

const FILE_ID = "file:";

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

export interface MentionRecency {
  readonly accepted: readonly string[];
  readonly opened: readonly string[];
}

export interface MentionRanking {
  readonly rank: (
    rawQuery: string,
    hasConversationContext: boolean,
    recency: MentionRecency,
  ) => readonly (FileSuggestion | MentionSuggestion)[];
}

interface Entry {
  readonly file: MentionFile;
  readonly name: string;
  readonly path: string;
  readonly order: number;
}

interface Scored {
  readonly entry: Entry;
  readonly tier: number;
  readonly accepted: number;
  readonly opened: number;
}

const CONVERSATION_SUGGESTION: MentionSuggestion = {
  kind: "mention",
  id: "current-conversation",
  label: "Current conversation",
  description: "Use this conversation as context",
  icon: "more",
};

export function fuzzyMatch(query: string, text: string): boolean {
  let matched = 0;

  for (let index = 0; index < text.length && matched < query.length; index += 1) {
    if (text[index] === query[matched]) matched += 1;
  }

  return matched === query.length;
}

function fileTier(query: string, entry: Entry): number | undefined {
  if (query === "" || entry.name === query) return 0;

  if (entry.name.startsWith(query)) return 1;

  if (fuzzyMatch(query, entry.name)) return 2;

  if (entry.path.includes(query)) return 3;

  return fuzzyMatch(query, entry.path) ? 4 : undefined;
}

function compareScored(left: Scored, right: Scored): number {
  return (
    left.tier - right.tier ||
    left.accepted - right.accepted ||
    left.opened - right.opened ||
    left.entry.name.localeCompare(right.entry.name) ||
    left.entry.path.localeCompare(right.entry.path) ||
    left.entry.order - right.entry.order
  );
}

function keepBest(best: Scored[], next: Scored, limit: number): void {
  const last = best.at(-1);

  if (best.length === limit && last !== undefined && compareScored(next, last) >= 0) return;
  const at = best.findIndex((held) => compareScored(next, held) < 0);
  best.splice(at === -1 ? best.length : at, 0, next);

  if (best.length > limit) best.pop();
}

function fileSuggestion(scored: Scored, marksRecent: boolean): FileSuggestion {
  const file = scored.entry.file;

  const shown = file.displayPath.replace(/\/$/u, "");

  const suggestion: FileSuggestion = {
    kind: "file",
    id: `${FILE_ID}${file.path}`,
    label: file.label.replace(/\/$/u, ""),
    description:
      file.kind === "folder" ? shown : shown.slice(0, Math.max(0, shown.lastIndexOf("/"))),
    icon: file.kind,
    file,
  };

  return marksRecent && (Number.isFinite(scored.accepted) || Number.isFinite(scored.opened))
    ? { ...suggestion, recent: true }
    : suggestion;
}

export function knownMentionFiles(root: string, recency: MentionRecency): readonly MentionFile[] {
  const prefix = `${root.replace(/\/$/u, "")}/`;

  const paths = new Set([
    ...recency.accepted.flatMap((id) => (id.startsWith(FILE_ID) ? [id.slice(FILE_ID.length)] : [])),
    ...recency.opened,
  ]);

  return [...paths].flatMap((path) =>
    path.startsWith(prefix) && path.length > prefix.length
      ? [
          mentionFile(root, {
            path: path.slice(prefix.length).replace(/\/$/u, ""),
            kind: path.endsWith("/") ? "directory" : "file",
          }),
        ]
      : [],
  );
}

export function createMentionSuggestionRanking(files: readonly MentionFile[]): MentionRanking {
  let entries: readonly Entry[] | undefined;

  const indexed = (): readonly Entry[] =>
    (entries ??= files.map((file, order) => ({
      file,
      name: file.label.replace(/\/$/u, "").toLocaleLowerCase(),
      path: file.displayPath.toLocaleLowerCase(),
      order,
    })));

  const rankEntries = (
    query: string,
    candidates: readonly Entry[],
    recency: MentionRecency,
    limit: number,
  ): readonly Scored[] => {
    const accepted = new Map(recency.accepted.map((id, position) => [id, position]));
    const opened = new Map(recency.opened.map((path, position) => [path, position]));
    const best: Scored[] = [];

    for (const entry of candidates) {
      const tier = fileTier(query, entry);

      if (tier !== undefined) {
        keepBest(
          best,
          {
            entry,
            tier,
            accepted: accepted.get(`${FILE_ID}${entry.file.path}`) ?? Infinity,
            opened: opened.get(entry.file.path) ?? Infinity,
          },
          limit,
        );
      }
    }

    return best;
  };

  return {
    rank: (rawQuery, hasConversationContext, recency) => {
      const query = rawQuery.trim().toLocaleLowerCase();

      const conversation =
        hasConversationContext &&
        (CONVERSATION_SUGGESTION.label.toLocaleLowerCase().includes(query) ||
          CONVERSATION_SUGGESTION.description.toLocaleLowerCase().includes(query))
          ? [CONVERSATION_SUGGESTION]
          : [];

      return [
        ...conversation,
        ...rankEntries(query, indexed(), recency, MAX_FILE_SUGGESTIONS).map((scored) =>
          fileSuggestion(scored, query === ""),
        ),
      ];
    },
  };
}
