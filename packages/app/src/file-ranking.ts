import type { MentionFile } from "./conversation/message-references.ts";

interface SearchableFile {
  readonly file: MentionFile;
  readonly label: string;
  readonly description: string;
}

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

      if (prefixes.length === limit) break;
    }

    return [...prefixes, ...substrings, ...descriptions].slice(0, limit);
  };
}
