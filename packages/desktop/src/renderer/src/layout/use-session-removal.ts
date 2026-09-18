import { useRouter } from "@tanstack/react-router";
import { keys, queryClient } from "../queries.ts";
import type { HostState } from "../../../shared/ipc.ts";
import type { SessionId } from "@nyte-ai/protocol";
import { paneControllerForWorkspace } from "./pane-context.tsx";
import { activeSelection } from "./pane-layout.ts";

/** Restore the removed pane only if the user has not navigated elsewhere. */
export function useSessionRemoval(): (
  workspacePath: string | null,
  sessionId: SessionId,
) => () => void {
  const router = useRouter();
  return (workspacePath, sessionId) => {
    const controller = paneControllerForWorkspace(workspacePath ?? undefined);
    const previous = controller.getSnapshot().layout;
    const restore = controller.removeSessionWithUndo(sessionId);
    const removed = controller.getSnapshot().layout;
    const navigate = (): void => {
      const host = queryClient.getQueryData<HostState>(keys.host);
      if (host === undefined || (host.workspace?.path ?? null) !== workspacePath) return;
      if (
        router.state.location.pathname !== "/" &&
        !router.state.location.pathname.startsWith("/session/")
      )
        return;
      const selection = activeSelection(controller.getSnapshot().layout);
      if (selection.kind === "blank") void router.navigate({ to: "/" });
      else
        void router.navigate({
          to: "/session/$sessionId",
          params: { sessionId: selection.sessionId },
        });
    };
    if (previous !== removed) navigate();
    return () => {
      if (restore()) navigate();
    };
  };
}
