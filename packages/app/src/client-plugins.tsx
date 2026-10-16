import { isValidElement } from "react";
import type { ReactNode } from "react";
import { mountClientPlugins } from "@nyte-ai/plugin/client/mount";
import type { ClientPlugins } from "@nyte-ai/plugin/client/mount";
import notifications from "@nyte-ai/plugin/client/notifications";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import questions from "@nyte-ai/plugin/client/questions";
import renderers from "@nyte-ai/plugin/client/transcript";
import type { Placement, SessionId } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { canvasRenderers } from "./conversation/canvas-frame.tsx";
import { connected, connection, directoryWatch } from "./sdk.tsx";

let mounting: Promise<ClientPlugins> | undefined;

let mounted: ClientPlugins | undefined;

/**
 * Mounts the desktop's client plugins once the host connects and feeds them
 * the session directory, so a run that ends anywhere reaches their hooks.
 */
export function watchClientPlugins(session: () => SessionId | undefined): () => void {
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

  feed();

  return directory.subscribe(feed);
}

export function drawPart(
  sessionId: SessionId,
  message: PartMessage,
  placement: Placement,
): ReactNode {
  const drawn = mounted?.draw(connection().session(sessionId), message, placement);

  return isValidElement(drawn) ? drawn : null;
}
