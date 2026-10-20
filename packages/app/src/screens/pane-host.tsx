import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { keyOwner } from "../shell/focus-owner.ts";
import { BlankConversation } from "./blank-conversation.tsx";
import { SessionConversation } from "./session-conversation.tsx";
import { props } from "@stylexjs/stylex";
import {
  Activity,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, RefObject } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { receiveChatExcerpts } from "../conversation/add-to-chat.ts";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import {
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import type { PaneState } from "../layout/pane-layout.ts";
import { useSessionPaneDropTarget } from "../layout/session-dnd.tsx";
import { useHostState } from "../queries.ts";
import { sessionsWatch, useWatchSelect } from "../sdk.tsx";
import { useMountEffect } from "../use-mount-effect.ts";

import { ReferenceOpenerProvider } from "../conversation/reference-opener.tsx";
import { workbenchViewKey } from "../workbench/controller.ts";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";

function TypeToCompose({
  input,
}: {
  readonly input: RefObject<ComposerEditorHandle | null>;
}): null {
  useMountEffect(() => {
    const route = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1 ||
        (event.key === " " && document.activeElement !== document.body) ||
        keyOwner() !== undefined
      )
        return;
      input.current?.focus({ preventScroll: true });
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

  const attachInput = useCallback((element: ComposerEditorHandle | null) => {
    inputRef.current = element;
  }, []);

  const host = useHostState();
  const workspacePath = host.data.workspace?.path;

  const referenceOpener = useMemo(
    () => workbenchReferenceOpener({ viewKey: workbenchViewKey(workspacePath), workspacePath }),
    [workspacePath],
  );

  useLayoutEffect(() => {
    if (focusRequest.paneId !== pane.id || keyOwner()?.closest("[data-nyte-pane-id]") === null)
      return;
    inputRef.current?.focus();
  }, [focusRequest.paneId, focusRequest.revision, pane.id]);

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
      {activePane(layout).id === pane.id && (
        <>
          <TypeToCompose input={inputRef} />
          <ReceiveExcerpts input={inputRef} />
        </>
      )}
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
