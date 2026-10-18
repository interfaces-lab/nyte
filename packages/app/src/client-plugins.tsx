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
import { RawPartView } from "./conversation/raw-part.tsx";
import { connected, connection, directoryWatch } from "./sdk.tsx";

let mounting: Promise<ClientPlugins> | undefined;

let mounted: ClientPlugins | undefined;

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
  if (mounted === undefined) return null;
  const drawn = mounted.draw(connection().session(sessionId), message, placement);

  return isValidElement(drawn) ? drawn : <RawPartView message={message} />;
}
