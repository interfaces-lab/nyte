import type { ToolDefinition } from "../kernel/loop/types.ts";
import { type JsonObject, parsePatchFacts } from "@nyte-ai/client";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
} from "./edit-diff.ts";
import { requireEnv } from "./env.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToCwd } from "./support/path-utils.ts";

const replaceEditSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
  },
  {},
);

const editSchema = Type.Object(
  {
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
    edits: Type.Array(replaceEditSchema, {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    }),
  },
  {},
);

export type EditToolInput = Static<typeof editSchema>;
export interface EditToolDetails {
  /** Display-oriented diff of the changes made */
  diff: string;
  /** Standard unified patch of the changes made */
  patch: string;
  /** Line number of the first change in the new file (for editor navigation) */
  firstChangedLine?: number;
}

const serializedEditsSchema = Type.String();

function prepareEditArguments(input: JsonObject): JsonObject {
  if (Value.Check(serializedEditsSchema, input.edits)) {
    try {
      const parsed: unknown = JSON.parse(input.edits);
      if (Array.isArray(parsed)) input.edits = parsed;
      else if (Value.Check(replaceEditSchema, parsed)) input.edits = [parsed];
    } catch {}
  } else if (Value.Check(replaceEditSchema, input.edits)) input.edits = [input.edits];
  const legacyEdit = { oldText: input.oldText, newText: input.newText };
  if (!Value.Check(replaceEditSchema, legacyEdit)) return input;
  const { oldText: _oldText, newText: _newText, ...rest } = input;
  const edits = Array.isArray(input.edits) ? [...input.edits] : [];
  edits.push(legacyEdit);
  return { ...rest, edits };
}

export function createEditToolDefinition(): ToolDefinition<
  typeof editSchema,
  EditToolDetails | undefined
> {
  return {
    label: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: editSchema,
    present({ path }, _context, result) {
      const facts =
        result?.details === undefined ? undefined : parsePatchFacts(result.details.patch);
      if (facts === undefined) return { kind: "file_edit", path };
      return {
        kind: "file_patch",
        op: "edit",
        path,
        patch: facts.patch,
        added: facts.added,
        removed: facts.removed,
      };
    },
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    prepareArguments: prepareEditArguments,
    async execute({ path, edits }, call) {
      if (edits.length === 0) {
        throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
      }
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
        const info = await env.stat(absolutePath);
        throwIfAborted();

        if (info === undefined) throw new Error(`Could not edit file: ${path}. File not found.`);

        if (info.kind !== "file") throw new Error(`Could not edit file: ${path}. Not a file.`);

        const buffer = await env.readFile(absolutePath);
        const rawContent = buffer.toString("utf-8");
        throwIfAborted();

        // Strip BOM before matching. The model will not include an invisible BOM in oldText.
        const bom = rawContent.startsWith("\uFEFF") ? "\uFEFF" : "";
        const content = rawContent.slice(bom.length);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const { baseContent, newContent } = applyEditsToNormalizedContent(
          normalizedContent,
          edits,
          path,
        );
        throwIfAborted();

        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await env.writeFile(absolutePath, finalContent);
        throwIfAborted();

        const diffResult = generateDiffString(baseContent, newContent);
        const patch = generateUnifiedPatch(path, baseContent, newContent);
        return {
          content: [
            {
              type: "text",
              text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
            },
          ],
          details: { diff: diffResult.diff, patch, firstChangedLine: diffResult.firstChangedLine },
        };
      });
    },
  };
}
