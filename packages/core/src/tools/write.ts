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
import { Unsafe } from "typebox";
import type { AgentTool } from "../types.ts";
import { toolResultContent } from "../utils/tool-result.ts";
import { type FileMutationDetails, generateFileMutationDetails } from "./edit-diff.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToCwd } from "./support/path-utils.ts";

export interface WriteToolInput {
  /** Path to the file to write (relative or absolute) */
  path: string;
  /** Content to write to the file */
  content: string;
}

const writeParameters = Unsafe<WriteToolInput>({
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Path to the file to write (relative or absolute)",
    },
    content: {
      type: "string",
      description: "Content to write to the file",
    },
  },
  required: ["path", "content"],
});

interface WriteInputFields {
  readonly path?: unknown;
  readonly content?: unknown;
}

function isWriteInputObject(value: unknown): value is WriteInputFields {
  return typeof value === "object" && value !== null;
}

function hasWritePath(
  value: WriteInputFields,
): value is WriteInputFields & Pick<WriteToolInput, "path"> {
  return typeof value.path === "string";
}

function hasWriteContent(
  value: WriteInputFields,
): value is WriteInputFields & Pick<WriteToolInput, "content"> {
  return typeof value.content === "string";
}

type WriteArgumentPreparer = NonNullable<
  AgentTool<typeof writeParameters, FileMutationDetails>["prepareArguments"]
>;

const parseWriteParams: WriteArgumentPreparer = (params) => {
  if (!isWriteInputObject(params)) {
    throw new Error("Invalid arguments for write: expected an object");
  }
  if (!hasWritePath(params)) {
    throw new Error('Invalid arguments for write: "path" must be a string');
  }
  if (!hasWriteContent(params)) {
    throw new Error('Invalid arguments for write: "content" must be a string');
  }
  return { path: params.path, content: params.content };
};

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
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: writeParameters,
    prepareArguments: parseWriteParams,
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
