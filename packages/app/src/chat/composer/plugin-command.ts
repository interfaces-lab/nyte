import type { CommandInfo } from "@nyte-ai/sdk";

export interface ParsedPluginCommand {
  readonly name: string;
  readonly argument: string;
}

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
