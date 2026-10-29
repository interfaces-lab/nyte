import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { keyOwner } from "../lib/focus-owner.ts";
import { BlankConversation } from "../chat/composer/new-chat-composer.tsx";
import { SessionConversation } from "../chat/session-conversation.tsx";
import { props } from "@stylexjs/stylex";
import { Activity, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, RefObject } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { receiveChatExcerpts } from "../references/add-to-chat.ts";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import {
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "./pane-context.tsx";
import { activePane } from "./pane-layout.ts";
import type { PaneState } from "./pane-layout.ts";
import { useSessionPaneDropTarget } from "./session-dnd.tsx";
import { useHostState } from "../data/host.ts";
import {
  clientActionAriaShortcut,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { sessionsWatch, sessionWatch } from "../data/watches.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

import { ReferenceOpenerProvider } from "../references/reference-opener.tsx";
import { workbenchViewKey } from "../workbench/controller.ts";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";

/**
 * Sends keys pressed outside any field to the active pane's composer: printable keys and paste land
 * in it, and the model shortcut opens its picker from anywhere but another field.
 */
function TypeToCompose({
  input,
}: {
  readonly input: RefObject<ComposerEditorHandle | null>;
}): null {
  useMountEffect(() => {
    const mac = nyte.platform === "darwin";

    const route = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const owner = keyOwner();

      if (
        resolveClientAction(event, mac, "workspace", clientCapabilities(nyte.host))?.id ===
        clientActions.selectModel.id
      ) {
        if (owner !== undefined && owner !== input.current?.readElement()) return;
        event.preventDefault();
        input.current
          ?.readElement()
          ?.closest("[data-composer-region]")
          ?.querySelector<HTMLElement>(
            `[aria-keyshortcuts="${clientActionAriaShortcut(clientActions.selectModel, mac)}"]`,
          )
          ?.click();

        return;
      }

      if (owner !== undefined || event.altKey) return;
      const paste = (mac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "v";

      const typed =
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.length === 1 &&
        (event.key !== " " || document.activeElement === document.body);

      if (paste || typed) input.current?.focus({ preventScroll: true });
    };

    window.addEventListener("keydown", route);

    return () => window.removeEventListener("keydown", route);
  });

  return null;
}

function ReceiveExcerpts({
  input,
}: {
  readonly input: RefObject<ComposerEditorHandle | null>;
}): null {
  useMountEffect(() =>
    receiveChatExcerpts(({ reference, image }) => {
      input.current?.insertReference(reference);

      if (image !== undefined) input.current?.attachFiles([image]);
    }),
  );

  return null;
}

function FocusComposer({
  input,
}: {
  readonly input: RefObject<ComposerEditorHandle | null>;
}): null {
  useMountEffect(() => {
    if (keyOwner()?.closest("[data-nyte-pane-id]") === null) return;
    input.current?.focus();
  });

  return null;
}

function HoldSession({ sessionId }: { readonly sessionId: SessionId }): null {
  useMountEffect(() => sessionWatch(sessionId).subscribe(() => undefined));

  return null;
}

const HOT_SESSIONS = 3;

type PanePosition =
  | { readonly kind: "single" }
  | { readonly kind: "leading"; readonly ratio: number }
  | { readonly kind: "trailing" };

export function PaneHost({
  pane,
  position,
  floatingMount,
}: {
  pane: PaneState;
  position: PanePosition;
  floatingMount: HTMLDivElement | null;
}): ReactElement {
  const actions = usePaneActions();
  const { focusRequest, layout } = usePaneControllerSnapshot();
  const viewStore = usePaneViewStateStore();

  const blankDraftId = useSyncExternalStore(
    viewStore.subscribe,
    () => viewStore.readBlank(pane.id).id,
    () => viewStore.readBlank(pane.id).id,
  );

  const shownSession = pane.selection.kind === "session" ? pane.selection.sessionId : undefined;
  const [hotSessions, setHotSessions] = useState<readonly SessionId[]>([]);

  const listedHot = useWatchSelect(sessionsWatch("all"), ({ value }) =>
    value === undefined
      ? undefined
      : hotSessions.filter((id) => value.some((session) => session.id === id)).join(","),
  );

  if (shownSession !== undefined && hotSessions[0] !== shownSession)
    setHotSessions(
      [shownSession, ...hotSessions.filter((id) => id !== shownSession)].slice(0, HOT_SESSIONS),
    );
  else if (listedHot !== undefined) {
    const listed = listedHot.split(",");
    const kept = hotSessions.filter((id) => id === shownSession || listed.includes(id));

    if (kept.length !== hotSessions.length) setHotSessions(kept);
  }

  const inputRef = useRef<ComposerEditorHandle | null>(null);
  const attachDropTarget = useSessionPaneDropTarget(pane.id);

  const attachInput = (element: ComposerEditorHandle | null) => {
    inputRef.current = element;
  };

  const host = useHostState();
  const workspacePath = host.data.workspace?.path;

  const referenceOpener = workbenchReferenceOpener({
    viewKey: workbenchViewKey(workspacePath),
    workspacePath,
  });

  return (
    <section
      ref={attachDropTarget}
      aria-label={`${activePane(layout).id === pane.id ? "Active " : ""}chat pane`}
      data-nyte-pane-id={pane.id}
      {...props(
        sessionScreenStyles.pane,
        position.kind === "single" && sessionScreenStyles.paneSingle,
        position.kind === "leading" && sessionScreenStyles.paneLeading(position.ratio),
        position.kind === "trailing" && sessionScreenStyles.paneTrailing,
      )}
      onPointerDown={() => actions.focus(pane.id)}
      onFocusCapture={() => actions.focus(pane.id)}
    >
      {focusRequest.paneId === pane.id && (
        <FocusComposer key={focusRequest.revision} input={inputRef} />
      )}
      {activePane(layout).id === pane.id && (
        <>
          <TypeToCompose input={inputRef} />
          <ReceiveExcerpts input={inputRef} />
        </>
      )}
      {hotSessions.map((sessionId) => (
        <HoldSession key={sessionId} sessionId={sessionId} />
      ))}
      <ReferenceOpenerProvider value={referenceOpener}>
        {hotSessions.toSorted().map((sessionId) => (
          <Activity key={sessionId} mode={sessionId === shownSession ? "visible" : "hidden"}>
            <SessionConversation
              presentation="full"
              floatingMount={
                sessionId === shownSession && activePane(layout).id === pane.id
                  ? floatingMount
                  : null
              }
              paneId={pane.id}
              sessionId={sessionId}
              inputRef={attachInput}
            />
          </Activity>
        ))}
        {shownSession === undefined && (
          <BlankConversation key={blankDraftId} paneId={pane.id} inputRef={attachInput} />
        )}
      </ReferenceOpenerProvider>
    </section>
  );
}
