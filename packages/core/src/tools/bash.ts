import type { ShellFacts } from "@nyte-ai/protocol";
import type { ToolDefinition } from "../kernel/loop/types.ts";
import { ToolError, toolResultContent, toolResultText } from "../kernel/loop/tool-result.ts";
import { type Static, Type } from "typebox";
import { OutputAccumulator } from "./support/output-accumulator.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "./support/truncate.ts";

/** Output limit of `structuredContent.output`, which programmatic callers such as codemode scripts receive. */
const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024;

const bashSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
});

export type BashToolInput = Static<typeof bashSchema>;

/**
 * Result for programmatic callers such as codemode scripts. A non-zero exit code is an error result for the model, but scripts still resolve to this value.
 * `output` is not limited like the model-facing output: callers decide how much of it reaches the model.
 */
const bashOutputSchema = Type.Object({
  output: Type.String({ description: "Combined stdout and stderr, possibly truncated" }),
  truncated: Type.Boolean(),
  full_output_path: Type.Optional(Type.String({ description: "Full output, when truncated" })),
  exit_code: Type.Number(),
  wall_time_seconds: Type.Number(),
});

export type BashToolOutput = Static<typeof bashOutputSchema>;

export interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
  /** Set once the command ended, however it ended. */
  durationMs?: number;
}

export interface BashToolOptions {
  /** Command prefix prepended to every command (for example shell setup commands) */
  commandPrefix?: string;
}

const BASH_UPDATE_THROTTLE_MS = 100;

export function createBashToolDefinition(
  options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined> {
  const commandPrefix = options?.commandPrefix;
  return {
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters: bashSchema,
    present: ({ command }, _context, result) => {
      const details = result?.details;

      if (details?.durationMs === undefined) return { kind: "shell", command };

      const facts: ShellFacts = {
        durationMs: details.durationMs,
        truncated: details.truncation !== undefined,
      };

      return {
        kind: "shell",
        command,
        facts:
          details.fullOutputPath === undefined
            ? facts
            : { ...facts, fullOutputPath: details.fullOutputPath },
      };
    },
    outputSchema: bashOutputSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute({ command, timeout }, call) {
      const { signal, update, env } = call;
      const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
      const output = new OutputAccumulator({ tempFilePrefix: "nyte-bash" });
      let acceptingOutput = true;
      let updateTimer: NodeJS.Timeout | undefined;
      let updateDirty = false;
      let lastUpdateAt = 0;

      const emitOutputUpdate = () => {
        if (!updateDirty) return;
        updateDirty = false;
        lastUpdateAt = Date.now();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        update({
          content: [{ type: "text", text: snapshot.content || "" }],
          details: {
            truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
          },
        });
      };

      const clearUpdateTimer = () => {
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = undefined;
        }
      };

      const scheduleOutputUpdate = () => {
        updateDirty = true;
        const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
        if (delay <= 0) {
          clearUpdateTimer();
          emitOutputUpdate();
          return;
        }
        updateTimer ??= setTimeout(() => {
          updateTimer = undefined;
          emitOutputUpdate();
        }, delay);
      };

      update({ content: [], details: undefined });

      const handleData = (data: Buffer) => {
        if (!acceptingOutput) return;
        output.append(data);
        scheduleOutputUpdate();
      };

      const finishOutput = async () => {
        acceptingOutput = false;
        output.finish();
        clearUpdateTimer();
        emitOutputUpdate();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        await output.closeTempFile();
        return snapshot;
      };

      const startedAt = performance.now();

      const settle = async (emptyText = "(no output)") => {
        const snapshot = await finishOutput();
        const spilled = snapshot.fullOutputPath;

        const fullOutputPath =
          spilled !== undefined && (await env.stat(spilled).catch(() => undefined))?.kind === "file"
            ? spilled
            : undefined;

        const where = fullOutputPath === undefined ? "" : `. Full output: ${fullOutputPath}`;
        const durationMs = Math.round(performance.now() - startedAt);
        const truncation = snapshot.truncation;
        let text = snapshot.content || emptyText;
        const details: BashToolDetails = truncation.truncated
          ? { durationMs, truncation, fullOutputPath }
          : { durationMs };
        if (truncation.truncated) {
          const startLine = truncation.totalLines - truncation.outputLines + 1;
          const endLine = truncation.totalLines;
          if (truncation.lastLinePartial) {
            const lastLineSize = formatSize(output.getLastLineBytes());
            text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize})${where}]`;
          } else if (truncation.truncatedBy === "lines") {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}${where}]`;
          } else {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)${where}]`;
          }
        }
        return { text, details, fullOutputPath, durationMs };
      };

      const appendStatus = (text: string, status: string) =>
        `${text ? `${text}\n\n` : ""}${status}`;

      try {
        let exitCode: number;
        try {
          const result = await env.exec(resolvedCommand, {
            onData: handleData,
            signal,
            timeout,
          });
          exitCode = result.exitCode;
        } catch (error) {
          const { text, details } = await settle("");
          const status =
            error instanceof ToolError
              ? toolResultText(error.result.content)
              : error instanceof Error
                ? error.message
                : String(error);
          throw new ToolError(
            { content: toolResultContent(appendStatus(text, status)), details },
            error instanceof ToolError ? error.reason : undefined,
          );
        }

        const { text: outputText, details, fullOutputPath, durationMs } = await settle();
        const wallTimeSeconds = Math.round(durationMs / 100) / 10;
        const fullOutput = await output.readFullOutput(STRUCTURED_OUTPUT_MAX_BYTES);
        const structuredContent: BashToolOutput = {
          output: fullOutput.content,
          truncated: fullOutput.truncated,
          exit_code: exitCode,
          wall_time_seconds: wallTimeSeconds,
        };
        if (fullOutput.truncated && fullOutputPath !== undefined)
          structuredContent.full_output_path = fullOutputPath;
        if (exitCode !== 0) {
          throw new ToolError(
            {
              content: [
                {
                  type: "text",
                  text: appendStatus(outputText, `Command exited with code ${exitCode}`),
                },
              ],
              details,
              structuredContent,
            },
            { kind: "exit", code: exitCode },
          );
        }
        return { content: [{ type: "text", text: outputText }], details, structuredContent };
      } finally {
        clearUpdateTimer();
      }
    },
  };
}
