/**
 * Streaming output accumulator for the bash tool, ported from pi
 * (earendil-works): keeps a bounded in-memory window and spills the full
 * stream to a temp file.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/output-accumulator.ts
 */
import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type TruncationResult,
  truncateTail,
} from "./truncate.ts";

export interface OutputAccumulatorOptions {
  maxLines?: number;
  maxBytes?: number;
  tempFilePrefix?: string;
}

export interface OutputSnapshot {
  content: string;
  truncation: TruncationResult;
  fullOutputPath?: string;
}

function defaultTempFilePath(prefix: string): string {
  const id = randomBytes(8).toString("hex");

  return join(tmpdir(), `${prefix}-${id}.log`);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

/**
 * Incrementally tracks streaming output with bounded memory.
 *
 * Appends decode chunks with a streaming UTF-8 decoder, keeps only a decoded
 * tail for display snapshots, and opens a temp file when the full output needs
 * to be preserved.
 */
export class OutputAccumulator {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly maxRollingBytes: number;
  private readonly tempFilePrefix: string;
  private readonly decoder = new TextDecoder();
  private readonly tempFileError: Promise<Error>;

  private rawChunks: Buffer[] = [];
  private tailText = "";
  private tailBytes = 0;
  private tailStartsAtLineBoundary = true;
  private totalRawBytes = 0;
  private totalDecodedBytes = 0;
  private completedLines = 0;
  private totalLines = 0;
  private currentLineBytes = 0;
  private hasOpenLine = false;
  private finished = false;
  private appending = false;

  private tempFilePath: string | undefined;
  private tempFileStream: WriteStream | undefined;
  private tempFileFailure: Error | undefined;
  private resolveTempFileError: (error: Error) => void = () => {};

  constructor(options: OutputAccumulatorOptions = {}) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRollingBytes = Math.max(this.maxBytes * 2, 1);
    this.tempFilePrefix = options.tempFilePrefix ?? "nyte-output";
    this.tempFileError = new Promise((resolve) => {
      this.resolveTempFileError = resolve;
    });
  }

  async append(data: Buffer): Promise<void> {
    if (this.finished) {
      throw new Error("Cannot append to a finished output accumulator");
    }

    if (this.appending) {
      throw new Error("Output accumulator appends must be awaited");
    }

    this.appending = true;

    try {
      this.totalRawBytes += data.length;
      this.appendDecodedText(this.decoder.decode(data, { stream: true }));

      if (this.tempFileStream || this.shouldUseTempFile()) {
        await this.ensureTempFile();
        await this.writeTempFile(data);
      } else if (data.length > 0) {
        this.rawChunks.push(data);
      }
    } finally {
      this.appending = false;
    }
  }

  async finish(): Promise<void> {
    if (this.finished) {
      return;
    }

    if (this.appending) {
      throw new Error("Cannot finish while an output append is pending");
    }

    this.finished = true;
    this.appendDecodedText(this.decoder.decode());

    if (this.shouldUseTempFile()) {
      await this.ensureTempFile();
    }
  }

  snapshot(): OutputSnapshot {
    const tailTruncation = truncateTail(this.getSnapshotText(), {
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    });

    const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes;

    const truncatedBy = truncated
      ? (tailTruncation.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes ? "bytes" : "lines"))
      : null;

    const truncation: TruncationResult = {
      ...tailTruncation,
      truncated,
      truncatedBy,
      totalLines: this.totalLines,
      totalBytes: this.totalDecodedBytes,
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    };

    return {
      content: truncation.content,
      truncation,
      fullOutputPath: this.tempFilePath,
    };
  }

  waitForTempFileError(): Promise<Error> {
    return this.tempFileError;
  }

  async closeTempFile(): Promise<void> {
    const stream = this.tempFileStream;

    if (!stream) {
      return;
    }

    if (this.tempFileFailure) {
      throw this.tempFileFailure;
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        stream.off("finish", onFinish);
        reject(error);
      };

      const onFinish = () => {
        stream.off("error", onError);
        resolve();
      };

      stream.once("error", onError);
      stream.once("finish", onFinish);
      stream.end();
    });
    this.tempFileStream = undefined;
  }

  getLastLineBytes(): number {
    return this.currentLineBytes;
  }

  private appendDecodedText(text: string): void {
    if (text.length === 0) {
      return;
    }

    const bytes = byteLength(text);
    this.totalDecodedBytes += bytes;
    this.tailText += text;
    this.tailBytes += bytes;

    if (this.tailBytes > this.maxRollingBytes * 2) {
      this.trimTail();
    }

    let newlines = 0;
    let lastNewline = -1;

    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
      newlines++;
      lastNewline = i;
    }

    if (newlines === 0) {
      this.currentLineBytes += bytes;
      this.hasOpenLine = true;
    } else {
      this.completedLines += newlines;
      const tail = text.slice(lastNewline + 1);
      this.currentLineBytes = byteLength(tail);
      this.hasOpenLine = tail.length > 0;
    }

    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tailText, "utf-8");

    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length;

      return;
    }

    let start = buffer.length - this.maxRollingBytes;

    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
      start++;
    }

    this.tailStartsAtLineBoundary =
      start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
    this.tailText = buffer.subarray(start).toString("utf-8");
    this.tailBytes = byteLength(this.tailText);
  }

  private getSnapshotText(): string {
    if (this.tailStartsAtLineBoundary) {
      return this.tailText;
    }

    const firstNewline = this.tailText.indexOf("\n");

    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
  }

  private shouldUseTempFile(): boolean {
    return (
      this.totalRawBytes > this.maxBytes ||
      this.totalDecodedBytes > this.maxBytes ||
      this.totalLines > this.maxLines
    );
  }

  private async ensureTempFile(): Promise<void> {
    if (this.tempFileStream) {
      if (this.tempFileFailure) throw this.tempFileFailure;

      return;
    }

    this.tempFilePath = defaultTempFilePath(this.tempFilePrefix);
    const stream = createWriteStream(this.tempFilePath);
    this.tempFileStream = stream;
    stream.on("error", (error) => {
      if (this.tempFileFailure) return;
      this.tempFileFailure = error;
      this.resolveTempFileError(error);
    });

    const chunks = this.rawChunks;
    this.rawChunks = [];

    for (const chunk of chunks) {
      await this.writeTempFile(chunk);
    }
  }

  private async writeTempFile(data: Buffer): Promise<void> {
    if (data.length === 0) return;

    if (this.tempFileFailure) throw this.tempFileFailure;
    const stream = this.tempFileStream;

    if (!stream) throw new Error("Output temp file is not open");

    let accepted = true;

    const writeComplete = new Promise<void>((resolve, reject) => {
      accepted = stream.write(data, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    if (accepted) {
      await writeComplete;

      return;
    }

    const drained = new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        stream.off("error", onError);
        resolve();
      };

      const onError = (error: Error) => {
        stream.off("drain", onDrain);
        reject(error);
      };

      stream.once("drain", onDrain);
      stream.once("error", onError);
    });

    await Promise.all([writeComplete, drained]);
  }
}
