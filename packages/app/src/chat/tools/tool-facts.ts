import { toolOutput, toolStatus } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage, ToolStatus, ToolVerbs } from "@nyte-ai/plugin/client/presentation";
import type { ToolPartState } from "@nyte-ai/schema";

export interface ToolFacts {
  readonly status: ToolStatus;
  readonly running: boolean;
  readonly output: string;
  readonly durationMs: number | undefined;
  readonly verb: string | undefined;
}

/**
 * Which text a card shows as its output. `settled` shows only a settled call's output.
 * `progress-while-running` shows progress while the message runs, so a call cut off before it
 * settled shows nothing. `progress-while-unsettled` shows progress while the part is unsettled,
 * so a cut-off call keeps its last progress.
 */
type OutputPolicy = "settled" | "progress-while-running" | "progress-while-unsettled";

/**
 * Each tool card's output policy. A shell call and a tool line stream their progress; a subagent
 * keeps its last progress when cut off; the rest show only what a settled call returned, and the
 * script, browser, web and secret cards show even that only for a failure or not at all.
 */
const OUTPUT_POLICY = {
  edit: "settled",
  mcp: "settled",
  script: "settled",
  browser: "settled",
  web: "settled",
  secret: "settled",
  shell: "progress-while-running",
  line: "progress-while-running",
  subagent: "progress-while-unsettled",
} as const satisfies Record<string, OutputPolicy>;

export type ToolCardKind = keyof typeof OUTPUT_POLICY;

/**
 * What a tool card reads from its message: the status and tense come from `message`, the output
 * from `state`, which is the whole state while a cut row is open.
 */
export function toolFacts(
  message: ToolMessage,
  state: ToolPartState,
  verbs: ToolVerbs | undefined,
  card: ToolCardKind,
): ToolFacts {
  const status = toolStatus(message);
  const running = status.tense === "running";

  return {
    status,
    running,
    output: shownOutput(state, running, OUTPUT_POLICY[card]),
    durationMs: message.status.kind === "settled" ? message.status.endedAt - message.at : undefined,
    verb: status.tense === "none" ? undefined : verbs?.[status.tense],
  };
}

export function fileUrl(path: string, cwd: string | undefined): string | undefined {
  const absolute = path.startsWith("/") ? path : cwd === undefined ? undefined : `${cwd}/${path}`;

  if (absolute === undefined) return undefined;
  const url = new URL("file:///");
  url.pathname = absolute;

  return url.href;
}

export function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function shownOutput(state: ToolPartState, running: boolean, policy: OutputPolicy): string {
  const progress = state.phase === "running" ? (state.progress?.text ?? "") : "";

  switch (policy) {
    case "settled":
      return toolOutput(state);
    case "progress-while-running":
      return running ? progress : toolOutput(state);
    case "progress-while-unsettled":
      return state.phase === "running" ? progress : toolOutput(state);
    default: {
      const _exhaustive: never = policy;

      return _exhaustive;
    }
  }
}
