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
import { Unsafe } from "typebox";
import type { AgentTool, AgentToolResult } from "../types.ts";
import { toolResultContent } from "../utils/tool-result.ts";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  type Edit,
  type FileMutationDetails,
  generateFileMutationDetails,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit-diff.ts";
export type { Edit } from "./edit-diff.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToCwd } from "./support/path-utils.ts";

const editParametersSchema = Unsafe<EditToolInput>({
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Path to the file to edit (relative or absolute)",
    },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oldText: {
            type: "string",
            description:
              "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
          },
          newText: {
            type: "string",
            description: "Replacement text for this targeted edit.",
          },
        },
        required: ["oldText", "newText"],
      },
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    },
  },
  required: ["path", "edits"],
});

export interface EditToolInput {
  path: string;
  edits: Edit[];
}

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

interface EditInputFields {
  readonly path?: unknown;
  readonly edits?: unknown;
  readonly oldText?: unknown;
  readonly newText?: unknown;
}

function isEditInputObject(value: unknown): value is EditInputFields {
  return typeof value === "object" && value !== null;
}

function hasEditPath(
  value: EditInputFields,
): value is EditInputFields & Pick<EditToolInput, "path"> {
  return typeof value.path === "string";
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function isEditValue(value: unknown): value is Edit {
  return (
    isEditInputObject(value) &&
    typeof value.oldText === "string" &&
    typeof value.newText === "string"
  );
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

type EditArgumentPreparer = NonNullable<
  AgentTool<typeof editParametersSchema, EditToolDetails>["prepareArguments"]
>;

const parseEditInput: EditArgumentPreparer = (input) => {
  if (!isEditInputObject(input)) {
    throw new Error("Edit tool input is invalid. Expected an object.");
  }

  if (!hasEditPath(input)) {
    throw new Error("Edit tool input is invalid. path must be a string.");
  }

  let editsValue = input.edits;
  if (isStringValue(editsValue)) {
    try {
      editsValue = JSON.parse(editsValue);
    } catch {
      // The validation below reports one stable error for malformed and non-array values.
    }
  }

  const edits = isUnknownArray(editsValue) ? [...editsValue] : [];
  if (isEditValue(input)) {
    edits.push({ oldText: input.oldText, newText: input.newText });
  }
  if (edits.length === 0) {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
  }

  return {
    path: input.path,
    edits: edits.map((edit, index) => {
      if (!isEditInputObject(edit)) {
        throw new Error(`Edit tool input is invalid. edits[${index}] must be an object.`);
      }
      if (!isEditValue(edit)) {
        throw new Error(
          `Edit tool input is invalid. edits[${index}] must contain string oldText and newText.`,
        );
      }
      return { oldText: edit.oldText, newText: edit.newText };
    }),
  };
};

export function createEditTool(
  cwd: string,
): AgentTool<typeof editParametersSchema, EditToolDetails> {
  return {
    name: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    promptSnippet:
      "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText must match exactly)",
      "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
      "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ],
    parameters: editParametersSchema,
    prepareArguments: parseEditInput,
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
