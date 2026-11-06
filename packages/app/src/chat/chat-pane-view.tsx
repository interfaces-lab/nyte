import { props } from "@stylexjs/stylex";
import { createContext, use, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, RefObject } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { sessionScreenStyles } from "../panes/session-screen.stylex.ts";
import { keyOwner } from "../lib/focus-owner.ts";
import { receiveChatExcerpts } from "../references/add-to-chat.ts";
import { usePaneLayoutStore, usePaneViewStateStore } from "../panes/pane-context.tsx";
import type { PaneId } from "../panes/layout.ts";
import type { LayoutStore } from "../panes/layout-store.ts";
import type { PaneTabRender, PaneView } from "../panes/pane-views.tsx";
import { useSessionPaneDropTarget } from "../panes/session-dnd.tsx";
import {
  clientActionAriaShortcut,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import type { ChatFields } from "./chat-pane-kind.ts";
import { BlankConversation } from "./composer/blank-conversation.tsx";
import type { ComposerEditorHandle } from "./composer/composer-editor.tsx";
import { SessionConversation } from "./session-conversation.tsx";

export const PaneFloatingMount = createContext<HTMLDivElement | null>(null);

export const chatView: PaneView<ChatFields> = (input) => <ChatPane {...input} />;

function ChatPane({ pane, fields, focused }: PaneTabRender<ChatFields>): ReactElement {
  const store = usePaneLayoutStore();
  const viewStore = usePaneViewStateStore();
  const mount = use(PaneFloatingMount);
  const floatingMount = focused ? mount : null;

  const blankDraftId = useSyncExternalStore(
    viewStore.subscribe,
    () => viewStore.readBlank(pane).id,
    () => viewStore.readBlank(pane).id,
  );

  const inputRef = useRef<ComposerEditorHandle | null>(null);
  const attachDropTarget = useSessionPaneDropTarget(pane);
  const [focusRequest, setFocusRequest] = useState(focused ? 1 : 0);
  const selection = fields.selection;

  const attachInput = (element: ComposerEditorHandle | null) => {
    inputRef.current = element;
  };

  return (
    <section
      ref={attachDropTarget}
      aria-label={`${focused ? "Active " : ""}chat pane`}
      {...props(sessionScreenStyles.pane)}
    >
      <FocusRequests
        key={pane}
        store={store}
        pane={pane}
        onRequest={() => setFocusRequest((count) => count + 1)}
      />
      {focusRequest > 0 && <FocusComposer key={focusRequest} input={inputRef} />}
      {focused && (
        <>
          <TypeToCompose input={inputRef} />
          <ReceiveExcerpts input={inputRef} />
        </>
      )}
      {selection.kind === "session" && (
        <SessionConversation
          key={selection.sessionId}
          presentation="full"
          floatingMount={floatingMount}
          paneId={pane}
          sessionId={selection.sessionId}
          inputRef={attachInput}
        />
      )}
      {selection.kind === "blank" && (
        <BlankConversation key={blankDraftId} paneId={pane} inputRef={attachInput} />
      )}
    </section>
  );
}

function FocusRequests({
  store,
  pane,
  onRequest,
}: {
  readonly store: LayoutStore;
  readonly pane: PaneId;
  readonly onRequest: () => void;
}): null {
  useMountEffect(() =>
    store.onFocusRequest((requested) => {
      if (requested === pane) onRequest();
    }),
  );

  return null;
}

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
    receiveChatExcerpts((excerpt) => {
      const composer = input.current;
      const element = composer?.readElement();

      if (composer === null || element === null || element === undefined) return false;

      if ("reference" in excerpt) composer.insertReference(excerpt.reference);

      if (excerpt.image === undefined) return element;

      return composer.attachFiles([excerpt.image], excerpt.signal).then(() => element);
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
