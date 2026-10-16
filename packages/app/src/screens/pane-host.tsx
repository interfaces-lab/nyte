/** One pane of the stage: it routes focus and typing to its composer and hosts its chat. */
import { threadStyles } from "./thread.stylex.ts";
import { keyOwner } from "../shell/focus-owner.ts";
import { BlankConversation } from "./blank-conversation.tsx";
import { SessionConversation } from "./session-conversation.tsx";
import { props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactElement, RefObject } from "react";
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
import { useMountEffect } from "../use-mount-effect.ts";

import { ReferenceOpenerProvider } from "../conversation/reference-opener.tsx";
import { workbenchViewKey } from "../workbench/controller.ts";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";

/**
 * Typing while nothing owns the keys starts a message in the active pane.
 * Focus moves during keydown, so the browser types the character into the
 * composer itself; a key that belongs elsewhere is never taken.
 */
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

export type PanePosition =
  | { readonly kind: "single" }
  | { readonly kind: "leading"; readonly ratio: number }
  | { readonly kind: "trailing" };

/**
 * A pane takes focus when its controller asks, unless something outside the
 * panes owns the keys. The composer's key follows the active draft id through
 * a subscription, since a plain readBlank() in JSX can be frozen by
 * memoization.
 */
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

  const inputRef = useRef<ComposerEditorHandle | null>(null);
  const attachDropTarget = useSessionPaneDropTarget(pane.id);

  const attachInput = useCallback((element: ComposerEditorHandle | null) => {
    inputRef.current = element;
  }, []);

  const host = useHostState();
  const workspacePath = host.data?.workspace?.path;

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
        threadStyles.pane,
        position.kind === "single" && threadStyles.paneSingle,
        position.kind === "leading" && threadStyles.paneLeading(position.ratio),
        position.kind === "trailing" && threadStyles.paneTrailing,
      )}
      onPointerDown={() => actions.focus(pane.id)}
      onFocusCapture={() => actions.focus(pane.id)}
    >
      {activePane(layout).id === pane.id && <TypeToCompose input={inputRef} />}
      <ReferenceOpenerProvider value={referenceOpener}>
        {pane.selection.kind === "session" ? (
          <SessionConversation
            key={pane.selection.sessionId}
            presentation="full"
            floatingMount={activePane(layout).id === pane.id ? floatingMount : null}
            paneId={pane.id}
            sessionId={pane.selection.sessionId}
            inputRef={attachInput}
          />
        ) : (
          <BlankConversation key={blankDraftId} paneId={pane.id} inputRef={attachInput} />
        )}
      </ReferenceOpenerProvider>
    </section>
  );
}
