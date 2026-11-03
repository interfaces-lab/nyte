import { isJsonObject } from "@nyte-ai/schema";
import type { PrincipalId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { SessionAttachment, StreamingPart } from "../contract/server.ts";
import { changesSince, readWindow } from "../fold/window.ts";

export function attachSession(
  kernel: Pick<Kernel, "folds">,
  session: SessionId,
  principal: PrincipalId,
): SessionAttachment {
  const hold = kernel.folds.acquire(session, principal);

  return {
    ready: () => hold.ready(),
    seq: () => hold.state().seq,
    activation: () => hold.state().activation,
    read: (head, window, resume) => readWindow(hold.state(), head, window, resume),
    changesSince: (seq) => changesSince(hold.state(), seq),
    streaming: () =>
      Array.from(hold.state().parts.values()).flatMap((part): StreamingPart[] => {
        const state = part.state;

        return part.status.kind === "live" &&
          (part.partKind === "text" || part.partKind === "thinking") &&
          isJsonObject(state) &&
          typeof state.markdown === "string"
          ? [
              {
                part: part.id,
                run: part.status.run,
                version: part.version,
                markdown: state.markdown,
              },
            ]
          : [];
      }),
    subscribe: (listener) => hold.subscribe(() => listener()),
    release: () => hold.release(),
  };
}
