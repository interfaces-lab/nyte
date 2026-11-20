import { showsThinking, showsTool } from "@nyte-ai/plugin/client/presentation";
import type { ThinkingMessage, ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { readBrowserStep } from "@nyte-ai/plugin/browser/schema";
import { CODEMODE_TOOL } from "@nyte-ai/plugin/codemode/schema";
import type { BrowserCall } from "../tools/browser-call.tsx";
import type { StepMessage } from "./transcript-presentation.ts";

export type StepEntry =
  | {
      readonly kind: "thinking";
      readonly key: string;
      readonly message: ThinkingMessage;
      readonly markdown: string;
    }
  | {
      readonly kind: "tool";
      readonly key: string;
      readonly message: ToolMessage;
      readonly calls: readonly ToolMessage[];
    }
  | { readonly kind: "browser"; readonly key: string; readonly steps: readonly BrowserCall[] };

export interface StepCalls {
  readonly steps: readonly StepMessage[];
  readonly calls: ReadonlyMap<string, readonly ToolMessage[]>;
}

export function stepCalls(messages: readonly StepMessage[]): StepCalls {
  const calls = scriptCalls(messages);
  const nested = new Set([...calls.values()].flat());

  return {
    steps: messages.filter((message) => !showsTool(message) || !nested.has(message)),
    calls,
  };
}

export function stepEntries(steps: StepCalls, mergeThinking: boolean): readonly StepEntry[] {
  const entries: StepEntry[] = [];

  for (const message of steps.steps) {
    const previous = entries.at(-1);

    if (showsThinking(message)) {
      if (message.state.markdown.trim() === "") continue;

      if (mergeThinking && previous?.kind === "thinking") {
        entries[entries.length - 1] = {
          ...previous,
          message,
          markdown: `${previous.markdown}\n\n${message.state.markdown}`,
        };
        continue;
      }

      entries.push({
        kind: "thinking",
        key: message.id,
        message,
        markdown: message.state.markdown,
      });
      continue;
    }

    const step = readBrowserStep(message.state.name, message.state.args);

    if (step !== null) {
      if (previous?.kind === "browser")
        entries[entries.length - 1] = {
          ...previous,
          steps: [...previous.steps, { message, step }],
        };
      else entries.push({ kind: "browser", key: message.id, steps: [{ message, step }] });
      continue;
    }

    entries.push({
      kind: "tool",
      key: message.id,
      message,
      calls: steps.calls.get(message.state.call) ?? [],
    });
  }

  return entries;
}

function scriptCalls(
  messages: readonly StepMessage[],
): ReadonlyMap<string, readonly ToolMessage[]> {
  const tools = messages.filter(showsTool);
  const scripts = tools.filter((message) => message.state.name === CODEMODE_TOOL);

  return new Map(
    scripts.map((script) => [
      script.state.call,
      tools.filter((call) => call.state.call.startsWith(`${script.state.call}:`)),
    ]),
  );
}
