import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { keyOwner } from "../lib/focus-owner.ts";
import { BlankConversation } from "../chat/composer/blank-conversation.tsx";
import { SessionConversation } from "../chat/session-conversation.tsx";
import { props } from "@stylexjs/stylex";
import { useRef, useSyncExternalStore } from "react";
import type { ReactElement, RefObject } from "react";
import { receiveChatExcerpts } from "../references/add-to-chat.ts";
import type { ComposerEditorHandle } from "../chat/composer/composer-editor.tsx";
import {
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "./pane-context.tsx";
import { activePane } from "./pane-layout.ts";
import type { PaneState } from "./pane-layout.ts";
import { useSessionPaneDropTarget } from "./session-dnd.tsx";
import {
  clientActionAriaShortcut,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

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
          ?.closest("[data-composer-frame]")
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

  const inputRef = useRef<ComposerEditorHandle | null>(null);
  const attachDropTarget = useSessionPaneDropTarget(pane.id);

  const attachInput = (element: ComposerEditorHandle | null) => {
    inputRef.current = element;
  };

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
      {shownSession !== undefined && (
        <SessionConversation
          key={shownSession}
          presentation="full"
          floatingMount={activePane(layout).id === pane.id ? floatingMount : null}
          paneId={pane.id}
          sessionId={shownSession}
          inputRef={attachInput}
        />
      )}
      {shownSession === undefined && (
        <BlankConversation key={blankDraftId} paneId={pane.id} inputRef={attachInput} />
      )}
    </section>
  );
}
