import { isJsonObject } from "@nyte-ai/schema";
import type { PrincipalId, SessionId } from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { PartProgress, SessionAttachment, StreamingPart } from "../contract/server.ts";
import { changesAfter, readWindow } from "../fold/window.ts";

export function attachSession(
  kernel: Pick<Kernel, "folds">,
  session: SessionId,
  principal: PrincipalId,
): SessionAttachment {
  const hold = kernel.folds.acquire(session, principal);

  return {
    ready: () => hold.ready(),
    cursor() {
      const state = hold.state();

      return { seq: state.seq, mark: state[INDEX].ring.mark };
    },
    activation: () => hold.state().activation,
    read: (head, window, resume) => readWindow(hold.state(), head, window, resume),
    changesAfter: (cursor) => changesAfter(hold.state(), cursor),
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
    progress: () =>
      Array.from(hold.state().parts.values()).flatMap((part): PartProgress[] => {
        const state = part.state;

        return (part.status.kind === "live" || part.status.kind === "waiting") &&
          isJsonObject(state) &&
          state.phase === "running" &&
          state.progress !== undefined &&
          state.progress !== null
          ? [{ part: part.id, run: part.status.run, progress: state.progress }]
          : [];
      }),
    subscribe: (listener) => hold.subscribe(() => listener()),
    release: () => hold.release(),
  };
}
