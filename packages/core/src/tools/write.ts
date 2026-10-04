import type { ToolDefinition } from "../kernel/loop/types.ts";
import { parsePatchFacts } from "@nyte-ai/client";
import { dirname } from "node:path";
import { type Static, Type } from "typebox";
import { generateUnifiedPatch } from "./edit-diff.ts";
import { requireEnv } from "./env.ts";
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

export function createWriteToolDefinition(): ToolDefinition<
  typeof writeSchema,
  WriteToolDetails | undefined
> {
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
    async execute({ path, content }, call) {
      const { signal } = call;
      const env = requireEnv(call);
      const absolutePath = resolveToCwd(path, env.cwd);
      return withFileMutationQueue(env, absolutePath, async () => {
        // Do not reject from an abort event listener here: that would release the
        // mutation queue while an in-flight filesystem operation may still finish.
        // Checking signal.aborted after each await observes the same aborts while
        // keeping the queue locked until the current operation has settled.
        const throwIfAborted = (): void => {
          if (signal.aborted) throw new Error("Operation aborted");
        };

        throwIfAborted();
        const previousContent =
          (await env.stat(absolutePath)) === undefined
            ? ""
            : (await env.readFile(absolutePath)).toString("utf-8");
        throwIfAborted();

        await env.mkdir(dirname(absolutePath));
        throwIfAborted();

        await env.writeFile(absolutePath, content);
        throwIfAborted();

        return {
          content: [{ type: "text", text: `Successfully wrote to ${path}` }],
          details: { patch: generateUnifiedPatch(path, previousContent, content) },
        };
      });
    },
  };
}
