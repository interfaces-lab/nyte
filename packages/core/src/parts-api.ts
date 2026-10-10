import type { SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import { createPart, partHandle } from "./part-handle.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Session } from "./session.ts";

/** Returns `session.parts.create` and `session.part` for a connection in a session, bound over `createPart` and `partHandle`; the kernel's default `parts` slot delegates here. */
export function createPartsApi(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
): { readonly create: Session["parts"]["create"]; readonly part: Session["part"] } {
  return {
    create: (kind, input) => createPart(kernel, context, session, kind, input),
    part: (id) => partHandle(kernel, context, session, id),
  };
}
