/**
 * Read tool ported from pi's read tool, bound to Nyte's AgentTool
 * contract and direct filesystem access (pi routes reads through its
 * ExecutionEnv effects boundary). Images are detected by content (magic bytes)
 * and handed to the shared image pipeline for conversion and resizing.
 *
 * Based on https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/tools/read.ts
 */
import { constants } from "node:fs";
import { open, readFile, type FileHandle } from "node:fs/promises";
import { relative } from "node:path";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "../kernel/loop/types.ts";
import { processImage } from "../kernel/loop/image.ts";
import { toolResultContent } from "../kernel/loop/tool-result.ts";
import { argumentParser } from "./support/arguments.ts";
import { detectSupportedImageMimeType } from "./support/image.ts";
import { resolveReadPathAsync } from "./support/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "./support/truncate.ts";

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

interface BoundedTextRead {
  truncation: TruncationResult;
  totalFileLines: number;
  selectedLines: number;
  firstLineBytes: number;
}

const IMAGE_PROBE_BYTES = 256 * 1024;

const TEXT_READ_CHUNK_BYTES = 64 * 1024;

const readParameters = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export function createReadTool(
  cwd: string,
): AgentTool<typeof readParameters, ReadToolDetails | undefined> {
  return {
    name: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments, resized to fit inline limits; BMP is converted to a supported format. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readParameters,
    prepareArguments: argumentParser(readParameters),
    present: ({ path }) => ({ kind: "file_read", path }),
    async execute(_toolCallId, { path, offset, limit }, signal?) {
      const throwIfAborted = (): void => {
        if (signal?.aborted) throw new Error("Operation aborted");
      };

      throwIfAborted();
      const absolutePath = await resolveReadPathAsync(path, cwd);
      const title = relative(cwd, absolutePath);
      throwIfAborted();

      const file = await open(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK);
      let mimeType: string | undefined;

      try {
        if (!(await file.stat()).isFile()) throw new Error("Read requires a regular file");
        const probe = Buffer.allocUnsafe(IMAGE_PROBE_BYTES);
        const { bytesRead } = await file.read(probe, 0, probe.length, 0);
        throwIfAborted();
        mimeType = detectSupportedImageMimeType(probe.subarray(0, bytesRead));
      } finally {
        await file.close();
      }

      if (mimeType !== undefined) {
        const buffer = await readFile(absolutePath, { signal });
        throwIfAborted();
        const verifiedMimeType = detectSupportedImageMimeType(buffer);

        if (verifiedMimeType !== undefined) {
          const image = await readImage(buffer, verifiedMimeType);
          throwIfAborted();

          return { ...image, title };
        }
      }

      const startLine = offset ? Math.max(0, Math.trunc(offset - 1)) : 0;
      const startLineDisplay = startLine + 1;
      const lineLimit = limit === undefined ? undefined : Math.max(0, Math.trunc(limit));
      const textFile = await open(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK);
      let boundedRead: BoundedTextRead;

      try {
        if (!(await textFile.stat()).isFile()) throw new Error("Read requires a regular file");
        boundedRead = await readBoundedText(textFile, startLine, lineLimit, signal);
      } finally {
        await textFile.close();
      }

      throwIfAborted();

      const { truncation, totalFileLines, selectedLines } = boundedRead;

      if (startLine >= totalFileLines) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
      }

      let outputText: string;
      let details: ReadToolDetails | undefined;

      if (truncation.firstLineExceedsLimit) {
        const firstLineSize = formatSize(boundedRead.firstLineBytes);
        outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
        details = { truncation };
      } else if (truncation.truncated) {
        const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
        const nextOffset = endLineDisplay + 1;
        outputText = truncation.content;

        if (truncation.truncatedBy === "lines") {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
        } else {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
        }

        details = { truncation };
      } else if (lineLimit !== undefined && startLine + selectedLines < totalFileLines) {
        const remaining = totalFileLines - (startLine + selectedLines);
        const nextOffset = startLine + selectedLines + 1;
        outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
      } else {
        outputText = truncation.content;
      }

      return { content: toolResultContent(outputText), details, title };
    },
  };
}

async function readBoundedText(
  file: FileHandle,
  startLine: number,
  lineLimit: number | undefined,
  signal: AbortSignal | undefined,
): Promise<BoundedTextRead> {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(TEXT_READ_CHUNK_BYTES);
  const headLines: string[] = [];
  let headBytes = 0;
  let headOpen = true;
  let headStoppedBy: "lines" | "bytes" | undefined;
  let lineIndex = 0;
  let lineBytes = 0;
  let lineParts: string[] = [];
  let lineRetained = true;
  let selectedLines = 0;
  let selectedBytes = 0;
  let firstLineBytes = 0;
  let lastSelectedLineEmpty = false;
  let position = 0;

  const isSelectedLine = () =>
    lineIndex >= startLine && (lineLimit === undefined || lineIndex < startLine + lineLimit);

  const appendLineText = (text: string) => {
    if (!isSelectedLine()) return;
    const bytes = Buffer.byteLength(text, "utf-8");
    lineBytes += bytes;

    if (!headOpen || !lineRetained) return;

    if (lineBytes > DEFAULT_MAX_BYTES) {
      lineParts = [];
      lineRetained = false;

      return;
    }

    lineParts.push(text);
  };

  const finishLine = () => {
    if (isSelectedLine()) {
      const separatorBytes = selectedLines > 0 ? 1 : 0;
      selectedLines++;
      selectedBytes += separatorBytes + lineBytes;

      if (selectedLines === 1) firstLineBytes = lineBytes;
      lastSelectedLineEmpty = lineBytes === 0;

      if (headOpen) {
        if (headLines.length >= DEFAULT_MAX_LINES) {
          headOpen = false;
          headStoppedBy = "lines";
        } else if (!lineRetained || headBytes + separatorBytes + lineBytes > DEFAULT_MAX_BYTES) {
          headOpen = false;
          headStoppedBy = "bytes";
        } else {
          headLines.push(lineParts.join(""));
          headBytes += separatorBytes + lineBytes;
        }
      }
    }

    lineIndex++;
    lineBytes = 0;
    lineParts = [];
    lineRetained = true;
  };

  const consume = (text: string) => {
    let start = 0;

    for (let newline = text.indexOf("\n"); newline !== -1; newline = text.indexOf("\n", start)) {
      appendLineText(text.slice(start, newline));
      finishLine();
      start = newline + 1;
    }

    appendLineText(text.slice(start));
  };

  while (true) {
    if (signal?.aborted) throw new Error("Operation aborted");
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);

    if (bytesRead === 0) break;
    position += bytesRead;
    consume(decoder.decode(buffer.subarray(0, bytesRead), { stream: true }));
  }

  consume(decoder.decode());
  finishLine();

  const totalFileLines = lineIndex;
  const totalLines = selectedBytes === 0 ? 0 : selectedLines - (lastSelectedLineEmpty ? 1 : 0);
  const truncated = totalLines > DEFAULT_MAX_LINES || selectedBytes > DEFAULT_MAX_BYTES;
  const firstLineExceedsLimit = truncated && firstLineBytes > DEFAULT_MAX_BYTES;
  const headContent = headLines.join("\n");

  const content =
    !truncated && selectedBytes > headBytes && lastSelectedLineEmpty
      ? `${headContent}\n`
      : headContent;

  const outputLines = truncated ? headLines.length : totalLines;
  const outputBytes = truncated ? headBytes : selectedBytes;

  const truncatedBy = truncated
    ? (headStoppedBy ?? (selectedBytes > DEFAULT_MAX_BYTES ? "bytes" : "lines"))
    : null;

  return {
    totalFileLines,
    selectedLines,
    firstLineBytes,
    truncation: {
      content: firstLineExceedsLimit ? "" : content,
      truncated,
      truncatedBy,
      totalLines,
      totalBytes: selectedBytes,
      outputLines: firstLineExceedsLimit ? 0 : outputLines,
      outputBytes: firstLineExceedsLimit ? 0 : outputBytes,
      lastLinePartial: false,
      firstLineExceedsLimit,
      maxLines: DEFAULT_MAX_LINES,
      maxBytes: DEFAULT_MAX_BYTES,
    },
  };
}

async function readImage(
  buffer: Buffer,
  mimeType: string,
): Promise<AgentToolResult<ReadToolDetails | undefined>> {
  const processed = await processImage(buffer, mimeType);

  if (processed.kind === "omitted") {
    return {
      content: toolResultContent(`Read image file [${mimeType}]\n${processed.message}`),
      details: undefined,
    };
  }

  const notes = [`Read image file [${mimeType}]`, ...processed.hints];

  return {
    content: [
      { type: "text", text: notes.join("\n") },
      { type: "image", data: processed.data, mimeType: processed.mimeType },
    ],
    details: undefined,
  };
}
