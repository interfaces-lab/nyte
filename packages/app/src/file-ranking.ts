import type { MentionFile } from "@nyte-ai/client";

interface SearchableFile {
  readonly file: MentionFile;
  readonly label: string;
  readonly description: string;
}

/**
 * Ranks name prefixes, then name substrings, then path substrings.
 * One catalog owns one lazy index, not a growing cache of queries or catalogs.
 */
export function createFileRanking(files: readonly MentionFile[], limit: number) {
  let searchable: readonly SearchableFile[] | undefined;

  return (query: string): readonly MentionFile[] => {
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

      if (bucket !== undefined && bucket.length < limit) bucket.push(entry.file);

      // Later entries cannot outrank or precede these prefix matches.
      if (prefixes.length === limit) break;
    }

    return [...prefixes, ...substrings, ...descriptions].slice(0, limit);
  };
}
