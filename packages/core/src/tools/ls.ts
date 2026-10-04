import { Type, type Static } from "typebox";
import type { ToolDefinition } from "../kernel/loop/types.ts";
import { toolResultContent } from "../kernel/loop/tool-result.ts";
import { argumentParser } from "./support/arguments.ts";
import { resolveToCwd } from "./support/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "./support/truncate.ts";

export type LsToolInput = Static<typeof lsParameters>;

const DEFAULT_LIMIT = 500;

export interface LsToolDetails {
  truncation?: TruncationResult;
  entryLimitReached?: number;
}

const lsParameters = Type.Object({
  path: Type.Optional(
    Type.String({ description: "Directory to list (default: current directory)" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of entries to return (default: 500)" }),
  ),
});

export function createLsToolDefinition(): ToolDefinition<
  typeof lsParameters,
  LsToolDetails | undefined
> {
  return {
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: lsParameters,
    prepareArguments: argumentParser(lsParameters),
    present: ({ path }) => ({ kind: "list", path: path || "." }),
    async execute({ path, limit }, call) {
      const { signal, env } = call;
      const throwIfAborted = (): void => {
        if (signal.aborted) throw new Error("Operation aborted");
      };

      const title = path || ".";
      const dirPath = resolveToCwd(title, env);
      const effectiveLimit = limit ?? DEFAULT_LIMIT;

      throwIfAborted();
      const info = await env.stat(dirPath);
      throwIfAborted();

      if (info === undefined) throw new Error(`Path not found: ${dirPath}`);

      if (info.kind !== "directory") throw new Error(`Not a directory: ${dirPath}`);

      let entries: string[];

      try {
        entries = await env.readdir(dirPath);
      } catch (error) {
        throwIfAborted();
        throw new Error(
          `Cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      throwIfAborted();
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      const results: string[] = [];
      let entryLimitReached = false;

      for (const entry of entries) {
        if (results.length >= effectiveLimit) {
          entryLimitReached = true;
          break;
        }

        throwIfAborted();

        try {
          const entryInfo = await env.stat(env.resolve(dirPath, entry));
          throwIfAborted();

          if (entryInfo !== undefined)
            results.push(entry + (entryInfo.kind === "directory" ? "/" : ""));
        } catch {
          throwIfAborted();
          // A disappearing or unreadable entry does not invalidate the listing.
          continue;
        }
      }

      if (results.length === 0) {
        return { content: toolResultContent("(empty directory)"), details: undefined, title };
      }

      const truncation = truncateHead(results.join("\n"), {
        maxLines: Number.MAX_SAFE_INTEGER,
      });

      let output = truncation.content;
      const details: LsToolDetails = {};
      const notices: string[] = [];

      if (entryLimitReached) {
        notices.push(
          `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
        );
        details.entryLimitReached = effectiveLimit;
      }

      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        details.truncation = truncation;
      }

      if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

      return {
        content: toolResultContent(output),
        details: Object.keys(details).length > 0 ? details : undefined,
        title,
      };
    },
  };
}
