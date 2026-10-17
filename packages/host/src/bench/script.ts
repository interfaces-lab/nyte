import type { Reply, Request } from "./fake-models.ts";
import { titleReply } from "./fake-models.ts";

/** One scripted model request: which request it answers, and the reply. */
export interface Step {
  /** Names the step in the error an unexpected request gets. */
  readonly name: string;
  /** Whether `request` is the one this step answers; default any request. */
  readonly when?: (request: Request) => boolean;
  readonly reply: Reply | ((request: Request) => Reply);
}

/** An ordered conversation for `fakeModels({ fallback: script.answer })`. */
export interface Script {
  /** Answers a chat-title request with its title, taking no step, and any other request with the next step. A request the next step does not match, or one past the last step, gets a provider error naming the step and the request, so a drifted script fails loudly instead of answering out of order. */
  readonly answer: (request: Request) => Reply;
  /** The names of the steps no request has taken yet. */
  pending(): readonly string[];
}

/** Returns the `Script` that answers requests with `steps` in order. */
export function script(steps: readonly Step[]): Script {
  const left = [...steps];
  let answered = 0;

  return {
    answer(request) {
      const title = titleReply(request);

      if (title !== null) return { content: [{ type: "text", text: title }] };
      answered += 1;
      const step = left[0];

      if (step === undefined)
        return { error: `Unscripted request ${answered}: ${describeRequest(request)}.` };

      if (step.when !== undefined && !step.when(request))
        return {
          error: `Unscripted request ${answered}: expected ${step.name}, got ${describeRequest(request)}.`,
        };
      left.shift();

      return typeof step.reply === "function" ? step.reply(request) : step.reply;
    },
    pending: () => left.map((step) => step.name),
  };
}

/** Matches a request whose last message is the user's. */
export function afterUser(request: Request): boolean {
  return request.context.messages.at(-1)?.role === "user";
}

/** Returns a matcher for a request whose last message is the result of a call to `tool`. */
export function afterTool(tool: string): (request: Request) => boolean {
  return (request) => {
    const last = request.context.messages.at(-1);

    return last?.role === "toolResult" && last.toolName === tool;
  };
}

/** The text of the last tool result a request carries; empty when its last message is not one. */
export function lastToolText(request: Request): string {
  const last = request.context.messages.at(-1);

  if (last?.role !== "toolResult") return "";

  return last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function describeRequest(request: Request): string {
  const last = request.context.messages.at(-1);

  if (last === undefined) return "a request with no messages";

  return last.role === "toolResult"
    ? `the result of ${last.toolName}`
    : `a request ending with a ${last.role} message`;
}
