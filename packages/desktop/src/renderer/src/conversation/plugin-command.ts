import type { CommandInfo } from "@nyte-ai/core";

export interface ParsedPluginCommand {
  readonly name: string;
  readonly argument: string;
}

/** Parse a whole composer draft only when it names a command active in this session. */
export function parsePluginCommand(
  draft: string,
  commands: readonly CommandInfo[],
): ParsedPluginCommand | undefined {
  const input = draft.trim();
  if (!input.startsWith("/")) return undefined;

  const separator = input.search(/\s/);
  const name = input.slice(1, separator === -1 ? undefined : separator);
  if (name === "" || !commands.some((command) => command.name === name)) return undefined;

  return {
    name,
    argument: separator === -1 ? "" : input.slice(separator).trimStart(),
  };
}
