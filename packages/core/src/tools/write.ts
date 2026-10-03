import type { ToolDefinition } from "../kernel/loop/types.ts";
import { parsePatchFacts } from "@nyte-ai/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Static, Type } from "typebox";
import { generateUnifiedPatch } from "./edit-diff.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToCwd } from "./support/path-utils.ts";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteToolDetails {
  /** Standard unified patch from the previous content, empty for a new file */
  patch: string;
}

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
  /** Read a file's current content, or undefined when it does not exist */
  readFile: (absolutePath: string) => Promise<string | undefined>;
  /** Write content to a file */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Create directory recursively */
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  readFile: async (path) => {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  },
  writeFile: (path, content) => writeFile(path, content, "utf-8"),
  mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
  /** Custom operations for file writing. Default: local filesystem */
  operations?: WriteOperations;
}

export function createWriteToolDefinition(
  cwd: string,
  options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, WriteToolDetails | undefined> {
  const ops = options?.operations ?? defaultWriteOperations;
  return {
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
    present({ path }, _context, result) {
      const facts =
        result?.details === undefined ? undefined : parsePatchFacts(result.details.patch);
      if (facts === undefined) return { kind: "file_write", path };
      return {
        kind: "file_patch",
        op: "write",
        path,
        patch: facts.patch,
        added: facts.added,
        removed: facts.removed,
      };
    },
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute({ path, content }, { signal }) {
      const absolutePath = resolveToCwd(path, cwd);
      const dir = dirname(absolutePath);
      return withFileMutationQueue(absolutePath, async () => {
        // Do not reject from an abort event listener here: that would release the
        // mutation queue while an in-flight filesystem operation may still finish.
        // Checking signal.aborted after each await observes the same aborts while
        // keeping the queue locked until the current operation has settled.
        const throwIfAborted = (): void => {
          if (signal.aborted) throw new Error("Operation aborted");
        };

        throwIfAborted();
        const previousContent = (await ops.readFile(absolutePath)) ?? "";
        throwIfAborted();

        // Create parent directories if needed.
        await ops.mkdir(dir);
        throwIfAborted();

        // Write the file contents.
        await ops.writeFile(absolutePath, content);
        throwIfAborted();

        return {
          content: [{ type: "text", text: `Successfully wrote to ${path}` }],
          details: { patch: generateUnifiedPatch(path, previousContent, content) },
        };
      });
    },
  };
}
