/**
 * Edit tool ported from pi's edit tool, bound to Nyte's AgentTool
 * contract and direct filesystem access (pi routes file access through its
 * ExecutionEnv effects boundary). The matching logic lives in edit-diff.ts
 * and is unchanged.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/tools/edit.ts
 */

import { readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from "node:fs/promises";
import { relative } from "node:path";
import { Type, type Static } from "typebox";
import type { AgentTool, AgentToolCall, AgentToolResult } from "../types.ts";
import { toolResultContent } from "../utils/tool-result.ts";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  type FileMutationDetails,
  generateFileMutationDetails,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit-diff.ts";
export type { Edit } from "./edit-diff.ts";
import { argumentParser } from "./support/arguments.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToCwd } from "./support/path-utils.ts";

const editParameters = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(
    Type.Object({
      oldText: Type.String({
        description:
          "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
      }),
      newText: Type.String({ description: "Replacement text for this targeted edit." }),
    }),
    {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    },
  ),
});

export type EditToolInput = Static<typeof editParameters>;
export type EditToolDetails = FileMutationDetails;

interface ErrorWithCode {
  readonly code: unknown;
}

function hasErrorCode(value: unknown): value is ErrorWithCode {
  return typeof value === "object" && value !== null && "code" in value;
}

function editAccessError(path: string, cause: unknown): Error {
  const code = hasErrorCode(cause) ? String(cause.code) : String(cause);
  return new Error(`Could not edit file: ${path}. Error code: ${code}.`, {
    cause: cause instanceof Error ? cause : undefined,
  });
}

const parseEditArguments = argumentParser(editParameters);

/** Models sometimes send `edits` as a JSON string, or one replacement at the top level; both fold into `edits`. */
function prepareEditInput(input: AgentToolCall["arguments"]): EditToolInput {
  const raw: unknown = input.edits;
  let listed: unknown = raw;
  if (typeof raw === "string") {
    try {
      listed = JSON.parse(raw);
    } catch {
      // The strict check below reports the malformed value.
    }
  }
  const single: unknown = input.oldText;
  const singleNew: unknown = input.newText;
  const edits: unknown[] = [
    ...(Array.isArray(listed) ? listed : []),
    ...(typeof single === "string" && typeof singleNew === "string"
      ? [{ oldText: single, newText: singleNew }]
      : []),
  ];
  if (edits.length === 0) {
    throw new Error("Invalid arguments: edits must contain at least one replacement");
  }
  return parseEditArguments({ ...input, edits });
}

export function createEditTool(cwd: string): AgentTool<typeof editParameters, EditToolDetails> {
  return {
    name: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: editParameters,
    prepareArguments: prepareEditInput,
    async execute(_toolCallId, { path, edits }, signal): Promise<AgentToolResult<EditToolDetails>> {
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

        // Check that the target exists and is an editable file.
        let info: Awaited<ReturnType<typeof fsStat>>;
        try {
          info = await fsStat(absolutePath);
        } catch (error: unknown) {
          throwIfAborted();
          throw editAccessError(path, error);
        }
        if (!info.isFile()) {
          throw new Error(`Could not edit file: ${path}. Path is not a file.`);
        }
        throwIfAborted();

        // Read the file.
        let rawContent: string;
        try {
          rawContent = await fsReadFile(absolutePath, "utf-8");
        } catch (error: unknown) {
          throwIfAborted();
          throw editAccessError(path, error);
        }
        throwIfAborted();

        // Strip BOM before matching. The model will not include an invisible BOM in oldText.
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const { baseContent, newContent } = applyEditsToNormalizedContent(
          normalizedContent,
          edits,
          path,
        );
        throwIfAborted();

        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        try {
          await fsWriteFile(absolutePath, finalContent, "utf-8");
        } catch (error: unknown) {
          throwIfAborted();
          throw editAccessError(path, error);
        }
        throwIfAborted();

        return {
          content: toolResultContent(`Replaced ${edits.length} block(s) in ${path}.`),
          details: generateFileMutationDetails(path, baseContent, newContent),
          title: relative(cwd, absolutePath),
        };
      });
    },
  };
}
