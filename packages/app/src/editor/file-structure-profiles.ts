export const STRUCTURE_PROFILES = [
  {
    language: "javascript",
    aliases: ["javascript", "js", "jsx"],
  },
  {
    language: "typescript",
    aliases: ["typescript", "ts"],
  },
  {
    language: "tsx",
    aliases: ["tsx"],
  },
  {
    language: "python",
    aliases: ["python", "py"],
  },
  {
    language: "go",
    aliases: ["go"],
  },
  {
    language: "rust",
    aliases: ["rust", "rs"],
  },
  {
    language: "json",
    aliases: ["json"],
  },
  {
    language: "css",
    aliases: ["css"],
  },
  {
    language: "html",
    aliases: ["html"],
  },
  {
    language: "markdown",
    aliases: ["markdown", "md"],
  },
  {
    language: "yaml",
    aliases: ["yaml", "yml"],
  },
  {
    language: "bash",
    aliases: ["bash", "shell", "shellscript", "sh"],
  },
] as const;

export type StructureLanguage = (typeof STRUCTURE_PROFILES)[number]["language"];

export function structureLanguage(language: string): StructureLanguage | undefined {
  return STRUCTURE_PROFILES.find((profile) => profile.aliases.some((alias) => alias === language))
    ?.language;
}
