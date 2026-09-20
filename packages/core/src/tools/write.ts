/**
 * Write tool ported from pi's write tool, bound to Nyte's AgentTool
 * contract and direct filesystem access (pi routes writes through its
 * ExecutionEnv effects boundary).
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/tools/write.ts
 */
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, relative } from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "../kernel/loop/types.ts";
import { toolResultContent } from "../kernel/loop/tool-result.ts";
import { type FileMutationDetails, generateFileMutationDetails } from "./edit-diff.ts";
import { argumentParser } from "./support/arguments.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToCwd } from "./support/path-utils.ts";

const writeParameters = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

interface MissingFileError extends Error {
  readonly code: "ENOENT";
}

function isMissingFile(cause: unknown): cause is MissingFileError {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export function createWriteTool(
  cwd: string,
): AgentTool<typeof writeParameters, FileMutationDetails> {
  return {
    name: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeParameters,
    prepareArguments: argumentParser(writeParameters),
    present: ({ path }, _context, result) =>
      result === undefined
        ? { kind: "file_write", path }
        : { kind: "file_patch", op: "write", path, ...result.details },
    async execute(_toolCallId, { path, content }, signal?, _onUpdate?) {
      const absolutePath = resolveToCwd(path, cwd);
      return withFileMutationQueue(absolutePath, async () => {
        // Do not reject from an abort event listener here: that would release the
        // mutation queue while an in-flight filesystem operation may still finish.
        // Checking signal.aborted after each await observes the same aborts while
        // keeping the queue locked until the current operation has settled.
        const throwIfAborted = (): void => {
          if (signal?.aborted) throw new Error("Operation aborted");
        };

        throwIfAborted();

        let previousContent = "";
        try {
          previousContent = await fsReadFile(absolutePath, "utf-8");
        } catch (error: unknown) {
          throwIfAborted();
          if (!isMissingFile(error)) throw error;
        }
        throwIfAborted();

        // Create parent directories if needed.
        await fsMkdir(dirname(absolutePath), { recursive: true });
        throwIfAborted();

        // Write the file contents.
        await fsWriteFile(absolutePath, content, "utf-8");
        throwIfAborted();

        return {
          content: toolResultContent(`Wrote ${path}.`),
          details: generateFileMutationDetails(path, previousContent, content),
          title: relative(cwd, absolutePath),
        };
      });
    },
  };
}
