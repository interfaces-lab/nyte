import type { Reply, Request } from "./fake-models.ts";
import { titleReply } from "./fake-models.ts";

export interface Step {
  readonly name: string;
  readonly when?: (request: Request) => boolean;
  readonly reply: Reply | ((request: Request) => Reply);
}

export interface Script {
  readonly answer: (request: Request) => Reply;
  pending(): readonly string[];
}

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

export function afterUser(request: Request): boolean {
  return request.context.messages.at(-1)?.role === "user";
}

export function afterTool(tool: string): (request: Request) => boolean {
  return (request) => {
    const last = request.context.messages.at(-1);

    return last?.role === "toolResult" && last.toolName === tool;
  };
}

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
