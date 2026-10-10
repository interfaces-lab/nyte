import type { Authority } from "@nyte-ai/schema";
import type { Connection, Host, Kernel } from "@nyte-ai/core";

/** Describes the handler: how a request authenticates to a connection, the kernel slots `head.watch` and `parts.create` read, the maintenance surface, the body limit and the allowed origins. */
export type HandlerOptions = {
  connection(
    request: Request,
  ): Promise<
    { readonly connection: Connection; readonly authority: ReadonlySet<Authority> } | Response
  >;
  readonly kernel: Pick<
    Kernel,
    "store" | "bus" | "activation" | "catalog" | "jobs" | "pages" | "partDefinitions"
  >;
  readonly host?: Pick<Host, "plugins" | "principals">;
  readonly maxBodyBytes?: number;
  readonly origins?: readonly string[];
};

/** Returns the whole protocol as one fetch handler: `POST /<name>` per row, gated by the row's authority, input decoded strictly from the JSON body or from `X-Nyte-Input` with the bytes as the body, answered as JSON (`query`, `command`, `receipt`), server-sent events (`watch`, with `id: <seq>` on logged session events and `Last-Event-ID` resuming after it; JSON-frame `stream`s), or an octet stream (byte `stream`s, `job.output`); an error answers its encoded `SdkError` at the status `errorStatus` gives its code. */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  throw new Error("not implemented");
}
