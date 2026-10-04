import type { ImageResizeOptions } from "./support/image-resize.ts";
import type { AgentToolResult, ToolDefinition } from "../kernel/loop/types.ts";
import type { ImageContent, TextContent } from "@nyte-ai/schema";
import { type Static, Type } from "typebox";
import { processImage } from "./support/image-process.ts";
import { detectSupportedImageMimeType } from "./support/image.ts";
import { resolveReadPathAsync } from "./support/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "./support/truncate.ts";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

export interface ReadToolOptions {
  /** Whether to auto-resize images. Default: true */
  autoResizeImages?: boolean;
  /** Fallback resize profile when the execution context has no model metadata. */
  resizeOptions?: ImageResizeOptions;
}

export function createReadToolDefinition(
  options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> {
  const autoResizeImages = options?.autoResizeImages ?? true;
  const fallbackResizeOptions = options?.resizeOptions;
  return {
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    present: ({ path }) => ({ kind: "file_read", path }),
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute({ path, offset, limit }, call) {
      const { signal, env } = call;
      return new Promise<AgentToolResult<ReadToolDetails | undefined>>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          reject(new Error("Operation aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });

        void (async () => {
          try {
            const absolutePath = await resolveReadPathAsync(env, path);
            if (aborted) return;
            const buffer = await env.readFile(absolutePath);
            if (aborted) return;
            const mimeType = detectSupportedImageMimeType(buffer);
            let content: (TextContent | ImageContent)[];
            let details: ReadToolDetails | undefined;
            if (mimeType) {
              const processed = await processImage(buffer, mimeType, {
                autoResizeImages,
                resizeOptions: fallbackResizeOptions,
              });
              if (!processed.ok) {
                content = [
                  { type: "text", text: `Read image file [${mimeType}]\n${processed.message}` },
                ];
              } else {
                content = [
                  { type: "text", text: `Read image file [${processed.mimeType}]` },
                  { type: "image", data: processed.data, mimeType: processed.mimeType },
                ];
              }
            } else {
              const textContent = buffer.toString("utf-8");
              const allLines = textContent.split("\n");
              const totalFileLines = allLines.length;
              // Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
              const startLine = offset ? Math.max(0, offset - 1) : 0;
              const startLineDisplay = startLine + 1;
              // Check if offset is out of bounds.
              if (startLine >= allLines.length) {
                throw new Error(
                  `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
                );
              }
              let selectedContent: string;
              let userLimitedLines: number | undefined;
              // If limit is specified by the user, honor it first. Otherwise truncateHead decides.
              if (limit !== undefined) {
                const endLine = Math.min(startLine + limit, allLines.length);
                selectedContent = allLines.slice(startLine, endLine).join("\n");
                userLimitedLines = endLine - startLine;
              } else {
                selectedContent = allLines.slice(startLine).join("\n");
              }
              // Apply truncation, respecting both line and byte limits.
              const truncation = truncateHead(selectedContent);
              let outputText: string;
              if (truncation.firstLineExceedsLimit) {
                // First line alone exceeds the byte limit. Point the model at a bash fallback.
                const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
                outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
                details = { truncation };
              } else if (truncation.truncated) {
                // Truncation occurred. Build an actionable continuation notice.
                const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
                const nextOffset = endLineDisplay + 1;
                outputText = truncation.content;
                if (truncation.truncatedBy === "lines") {
                  outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
                } else {
                  outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
                }
                details = { truncation };
              } else if (
                userLimitedLines !== undefined &&
                startLine + userLimitedLines < allLines.length
              ) {
                // User-specified limit stopped early, but the file still has more content.
                const remaining = allLines.length - (startLine + userLimitedLines);
                const nextOffset = startLine + userLimitedLines + 1;
                outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
              } else {
                // No truncation and no remaining user-limited content.
                outputText = truncation.content;
              }
              content = [{ type: "text", text: outputText }];
            }

            if (aborted) return;
            signal.removeEventListener("abort", onAbort);
            resolve({ content, details });
          } catch (error: unknown) {
            signal.removeEventListener("abort", onAbort);
            if (!aborted) reject(error);
          }
        })();
      });
    },
  };
}
