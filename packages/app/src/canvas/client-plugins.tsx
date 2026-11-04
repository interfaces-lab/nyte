import { isValidElement, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { mountClientPlugins } from "@nyte-ai/plugin/client/mount";
import type { ClientPlugins } from "@nyte-ai/plugin/client/mount";
import notifications from "@nyte-ai/plugin/client/notifications";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import questions from "@nyte-ai/plugin/client/questions";
import renderers from "@nyte-ai/plugin/client/transcript";
import type { Placement, SessionId, SubmitDraft } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { canvasRenderers } from "./canvas-frame.tsx";
import { PartOrigin } from "../chat/transcript/part-origin.ts";
import { RawPartView } from "../chat/transcript/raw-part.tsx";
import { nyte } from "../contract/nyte.ts";
import { connected, connection, registries } from "../data/connection.ts";
import { sessionRows, subscribeSessionRows } from "../data/session-rows.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { hostWatch } from "../data/watches.ts";
import { chatWindow } from "../window/index.ts";
import { PartView } from "./part-view.tsx";

let mounting: Promise<ClientPlugins> | undefined;

let mounted: ClientPlugins | undefined;

const listeners = new Set<() => void>();

function settle(next: ClientPlugins | undefined): void {
  mounted = next;

  for (const listener of listeners) listener();
}

function subscribeMounted(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function readMounted(): ClientPlugins | undefined {
  return mounted;
}

function mount(session: () => SessionId | undefined): void {
  const started = connected().then((current) =>
    mountClientPlugins({
      connection: current,
      plugins: [
        ...(nyte.host.attention === undefined ? [notifications] : []),
        renderers,
        questions,
        canvasRenderers,
      ],
      client: { name: "desktop", frameworks: ["react"] },
      session: () => {
        const id = session();

        return id === undefined ? null : current.session(id);
      },
      looking: () => chatWindow.getSnapshot().looking,
      notify: (input) =>
        toast.add({
          type: input.level === "error" ? "error" : input.level === "warning" ? "warning" : "info",
          title: input.title ?? input.message,
          description: input.title === undefined ? undefined : input.message,
        }),
      report: (plugin, message) => toast.add({ type: "error", title: `${plugin}: ${message}` }),
    }),
  );

  mounting = started;
  void started.then((plugins) => {
    if (mounting === started) settle(plugins);
    else void plugins.dispose();
  });
}

export function watchClientPlugins(
  session: () => SessionId | undefined,
  focusMoved: (listener: () => void) => () => void,
): () => void {
  if (mounting === undefined) mount(session);

  const feed = (): void => {
    const { listed, rows } = sessionRows();

    if (listed) void mounting?.then((plugins) => plugins.sessionsChanged([...rows.values()]));
  };

  let focused: SessionId | undefined;

  const refocus = (): void => {
    const next = session();

    if (next === focused) return;
    const previous = focused;
    focused = next;

    if (next !== undefined)
      void mounting?.then((plugins) =>
        plugins.switched(
          previous === undefined ? null : connection().session(previous),
          connection().session(next),
        ),
      );
  };

  const remount = {
    clear(): void {
      const previous = mounted;
      settle(undefined);
      mount(session);
      void previous?.dispose();
      focused = undefined;
      feed();
      refocus();
    },
  };

  registries.add(remount);
  feed();
  refocus();
  const stopDirectory = subscribeSessionRows(feed);
  const stopFocus = focusMoved(refocus);

  return () => {
    registries.delete(remount);
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
  return <PluginPart sessionId={sessionId} message={message} placement={placement} />;
}

function PluginPart({
  sessionId,
  message,
  placement,
}: {
  readonly sessionId: SessionId;
  readonly message: PartMessage;
  readonly placement: Placement;
}): ReactNode {
  const plugins = useSyncExternalStore(subscribeMounted, readMounted, readMounted);

  const view = useWatchSelect(hostWatch("host"), (state) =>
    state.value?.views.find((entry) => entry.kind === message.partKind),
  );

  if (plugins === undefined) return null;
  const drawn = plugins.draw(connection().session(sessionId), message, placement);
  const origin = { sessionId, part: message.part };

  if (isValidElement(drawn)) return <PartOrigin value={origin}>{drawn}</PartOrigin>;

  if (view !== undefined)
    return (
      <PartOrigin value={origin}>
        <PartView sessionId={sessionId} message={message} view={view} />
      </PartOrigin>
    );

  return <RawPartView message={message} />;
}
