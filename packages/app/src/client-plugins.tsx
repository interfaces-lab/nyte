import { isValidElement } from "react";
import type { ReactNode } from "react";
import { mountClientPlugins } from "@nyte-ai/plugin/client/mount";
import type { ClientPlugins } from "@nyte-ai/plugin/client/mount";
import notifications from "@nyte-ai/plugin/client/notifications";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import questions from "@nyte-ai/plugin/client/questions";
import renderers from "@nyte-ai/plugin/client/transcript";
import type { Placement, SessionId, SubmitDraft } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { canvasRenderers } from "./conversation/canvas-frame.tsx";
import { connected, connection, directoryWatch } from "./sdk.tsx";

let mounting: Promise<ClientPlugins> | undefined;

let mounted: ClientPlugins | undefined;

/**
 * Mounts the desktop's client plugins once the host connects, feeds them the
 * session directory, so a run that ends anywhere reaches their hooks, and
 * tells them each time the focused session changes (`focusMoved` calls its
 * listener after any change that may move it).
 */
export function watchClientPlugins(
  session: () => SessionId | undefined,
  focusMoved: (listener: () => void) => () => void,
): () => void {
  mounting ??= connected().then(async (current) => {
    mounted = await mountClientPlugins({
      connection: current,
      plugins: [notifications, renderers, questions, canvasRenderers],
      client: { name: "desktop", frameworks: ["react"] },
      session: () => {
        const id = session();

        return id === undefined ? null : current.session(id);
      },
      notify: (input) =>
        toast.add({
          type: input.level === "error" ? "error" : input.level === "warning" ? "warning" : "info",
          title: input.title ?? input.message,
          description: input.title === undefined ? undefined : input.message,
        }),
      report: (plugin, message) => toast.add({ type: "error", title: `${plugin}: ${message}` }),
    });

    return mounted;
  });

  const plugins = mounting;
  const directory = directoryWatch("all");

  const feed = (): void => {
    const sessions = directory.value;

    if (sessions !== undefined) void plugins.then((mount) => mount.sessionsChanged(sessions));
  };

  let focused: SessionId | undefined;

  const refocus = (): void => {
    const next = session();

    if (next === focused) return;
    const previous = focused;
    focused = next;

    if (next !== undefined)
      void plugins.then((mount) =>
        mount.switched(
          previous === undefined ? null : connection().session(previous),
          connection().session(next),
        ),
      );
  };

  feed();
  refocus();
  const stopDirectory = directory.subscribe(feed);
  const stopFocus = focusMoved(refocus);

  return () => {
    stopDirectory();
    stopFocus();
  };
}

/** The draft the client plugins' before_submit hooks let through, as they rewrote it; throws with the reason one refused it. A window whose plugins failed to mount sends it as it is. */
export async function admitDraft(draft: SubmitDraft): Promise<SubmitDraft> {
  const plugins = await mounting?.catch(() => undefined);

  if (plugins === undefined) return draft;
  const decision = await plugins.beforeSubmit(draft);

  switch (decision.action) {
    case "continue":
      return draft;
    case "modify":
      return decision.value;
    case "reject":
      throw new Error(decision.reason);
    case "error":
      throw new Error(decision.message);
    default: {
      const _exhaustive: never = decision;

      return _exhaustive;
    }
  }
}

export function drawPart(
  sessionId: SessionId,
  message: PartMessage,
  placement: Placement,
): ReactNode {
  const drawn = mounted?.draw(connection().session(sessionId), message, placement);

  return isValidElement(drawn) ? drawn : null;
}
