/**
 * The browser agent across the process line: the host process runs the browser tools, and
 * main owns the pages they drive. The host asks for one `AgentCall` at a time and main answers
 * it from its `BrowserAgent`. Abort signals cannot be cloned, so a call never carries one.
 */
import type {
  BrowserActionResult,
  BrowserAgent,
  BrowserConsoleEntry,
  BrowserEvaluateResult,
} from "./browser-agent.ts";
import { sessionSurfaceId } from "./browser-agent.ts";

type Input<M extends keyof BrowserAgent> = Parameters<BrowserAgent[M]>[0];

export type AgentCall =
  | { readonly method: "open"; readonly input: Input<"open"> }
  | { readonly method: "snapshot"; readonly input: Input<"snapshot"> }
  | { readonly method: "click"; readonly input: Input<"click"> }
  | { readonly method: "type"; readonly input: Input<"type"> }
  | { readonly method: "press"; readonly input: Input<"press"> }
  | { readonly method: "scroll"; readonly input: Input<"scroll"> }
  | { readonly method: "wait"; readonly input: Input<"wait"> }
  | { readonly method: "console"; readonly input: Input<"console"> }
  | { readonly method: "evaluate"; readonly input: Input<"evaluate"> }
  | { readonly method: "capture"; readonly input: Input<"capture"> }
  | { readonly method: "release"; readonly input: Input<"release"> };

export type AgentAnswer =
  | { readonly kind: "action"; readonly result: BrowserActionResult }
  | { readonly kind: "evaluated"; readonly result: BrowserEvaluateResult }
  | { readonly kind: "console"; readonly entries: readonly BrowserConsoleEntry[] }
  | { readonly kind: "captured"; readonly bytes: Uint8Array | undefined }
  | { readonly kind: "released" };

/** Main's side: runs one call against the panel's agent. */
export async function answerAgent(agent: BrowserAgent, call: AgentCall): Promise<AgentAnswer> {
  switch (call.method) {
    case "open":
      return { kind: "action", result: await agent.open(call.input) };
    case "snapshot":
      return { kind: "action", result: await agent.snapshot(call.input) };
    case "click":
      return { kind: "action", result: await agent.click(call.input) };
    case "type":
      return { kind: "action", result: await agent.type(call.input) };
    case "press":
      return { kind: "action", result: await agent.press(call.input) };
    case "scroll":
      return { kind: "action", result: await agent.scroll(call.input) };
    case "wait":
      return { kind: "action", result: await agent.wait(call.input) };
    case "console":
      return { kind: "console", entries: await agent.console(call.input) };
    case "evaluate":
      return { kind: "evaluated", result: await agent.evaluate(call.input) };
    case "capture":
      return { kind: "captured", bytes: await agent.capture(call.input) };
    case "release":
      agent.release(call.input);

      return { kind: "released" };
    default: {
      const _exhaustive: never = call;

      return _exhaustive;
    }
  }
}

/** The host process's side: a `BrowserAgent` whose every call `ask`s main. */
export function remoteAgent(ask: (call: AgentCall) => Promise<AgentAnswer>): BrowserAgent {
  const action = async (call: AgentCall): Promise<BrowserActionResult> => {
    const answer = await ask(call);

    if (answer.kind !== "action")
      throw new Error(`Main answered a browser action with ${answer.kind}.`);

    return answer.result;
  };

  return {
    open: (input) => action({ method: "open", input: { ...input, signal: undefined } }),
    snapshot: (input) => action({ method: "snapshot", input: { ...input, signal: undefined } }),
    click: (input) => action({ method: "click", input: { ...input, signal: undefined } }),
    type: (input) => action({ method: "type", input: { ...input, signal: undefined } }),
    press: (input) => action({ method: "press", input: { ...input, signal: undefined } }),
    scroll: (input) => action({ method: "scroll", input: { ...input, signal: undefined } }),
    wait: (input) => action({ method: "wait", input: { ...input, signal: undefined } }),
    async console(input) {
      const answer = await ask({ method: "console", input });

      if (answer.kind !== "console") throw new Error(`Main answered console with ${answer.kind}.`);

      return answer.entries;
    },
    async evaluate(input) {
      const answer = await ask({ method: "evaluate", input: { ...input, signal: undefined } });

      if (answer.kind !== "evaluated")
        throw new Error(`Main answered evaluate with ${answer.kind}.`);

      return answer.result;
    },
    async capture(input) {
      const answer = await ask({ method: "capture", input });

      if (answer.kind !== "captured") throw new Error(`Main answered capture with ${answer.kind}.`);

      return answer.bytes;
    },
    release(input) {
      void ask({ method: "release", input }).catch(() => undefined);
    },
    sessionSurfaceId,
  };
}
