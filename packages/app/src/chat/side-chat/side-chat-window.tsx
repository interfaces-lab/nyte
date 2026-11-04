import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { mainHead, showsText } from "@nyte-ai/plugin/client/presentation";
import { Button } from "@nyte-ai/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Spinner } from "@nyte-ai/ui/spinner";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../../contract/nyte.ts";
import { addToChat, ADD_TO_CHAT_LABEL } from "../../references/add-to-chat.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import type { ComposerEditorHandle } from "../composer/composer-editor.tsx";
import { GRIP, Pip } from "./pip.tsx";
import {
  archiveSideChat,
  foldSideChat,
  openSideChat,
  showSideChat,
  sideChatExcerpt,
  startSideChat,
  summonSideChat,
  useSideChats,
  useSideChatWindow,
} from "./side-chats.ts";
import type { SideChatShown } from "./side-chats.ts";
import type { PaneId } from "../../panes/layout.ts";

const SIZE = { width: 380, height: 520 };

const styles = create({
  pane: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s1_5,
    paddingInline: space.s1_5,
    userSelect: "none",
    touchAction: "none",
    cursor: { default: "grab", ":active": "grabbing" },
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
  },
  actions: { display: "flex", alignItems: "center", gap: space.px, cursor: "default" },
  body: { position: "relative", display: "flex", flex: 1, minHeight: 0 },
  first: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: space.s2,
    flex: 1,
    padding: space.s3,
  },
  note: { margin: 0, color: role.contentSecondary },
  error: { margin: 0, color: role.contentAccent },
  /** Inset by `s2` at `radius.control`, so its corners follow the window's `radius.surface`. */
  field: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s1_5,
    borderRadius: radius.control,
    backgroundColor: role.bgMuted,
  },
  input: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    resize: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    font: "inherit",
    "::placeholder": { color: role.contentTertiary },
  },
  starting: { display: "flex", alignItems: "center", gap: space.s2, color: role.contentTertiary },
  pill: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    maxWidth: 280,
    padding: space.s1,
    touchAction: "none",
  },
  pillTitle: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dot: {
    flexShrink: 0,
    width: space.s2,
    height: space.s2,
    borderRadius: radius.pill,
    backgroundColor: role.contentAccent,
  },
});

/** Draws side chat `sessionId` with its composer, handing that composer to `inputRef`. */
export type SideChatConversation = ComponentType<{
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  readonly inputRef: (handle: ComposerEditorHandle | null) => void;
}>;

/**
 * `parent`'s side chats in a window over its transcript, kept above the composer. ⌘J opens it
 * from the active pane, on the side chat it last showed or the newest, and folds it again from
 * inside it; `focusMain` hands the keys back to the chat's own composer.
 */
export function SideChatWindow({
  parent,
  paneId,
  active,
  focusMain,
  conversation,
}: {
  readonly parent: SessionId;
  readonly paneId: PaneId;
  readonly active: boolean;
  readonly focusMain: () => void;
  readonly conversation: SideChatConversation;
}): ReactElement | null {
  const state = useSideChatWindow(parent);
  const sides = useSideChats(parent);
  const sideInput = useRef<ComposerEditorHandle | null>(null);

  const fold = (): void => {
    foldSideChat(parent, true);
    focusMain();
  };

  const shortcut = active && (
    <SideChatShortcut
      key={parent}
      parent={parent}
      onFold={fold}
      onSummoned={() => requestAnimationFrame(() => sideInput.current?.focus())}
    />
  );

  if (state.kind === "closed") return shortcut || null;
  const shown = state.shown;
  const chat = shown.kind === "chat" ? sides.find((side) => side.id === shown.id) : undefined;
  const title = shown.kind === "starting" ? shown.question : (chat?.name ?? "New side chat");

  return (
    <>
      {shortcut}
      <Pip
        label="Side chat"
        size={SIZE}
        folded={state.folded}
        pill={
          <Pill
            title={title}
            chat={chat}
            onOpen={() => {
              foldSideChat(parent, false);
              requestAnimationFrame(() => sideInput.current?.focus());
            }}
          />
        }
      >
        <div {...props(styles.pane)}>
          <div {...GRIP} {...props(styles.header)}>
            <Button
              size="xs"
              iconOnly
              icon="drag-handle"
              aria-label="Move Side Chat"
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            />
            <span {...props(text.sm, styles.title)}>{title}</span>
            <div {...props(styles.actions)} onPointerDown={(event) => event.stopPropagation()}>
              <Menu>
                <MenuTrigger
                  render={
                    <Button size="xs" iconOnly icon="chevron-up-down" aria-label="Side Chats" />
                  }
                />
                <MenuContent align="end">
                  {sides.map((side) => (
                    <MenuItem
                      key={side.id}
                      icon={side.id === chat?.id ? "checkmark" : "bubble-question"}
                      onClick={() => showSideChat(parent, side.id)}
                    >
                      {side.name ?? "Side chat"}
                    </MenuItem>
                  ))}
                  {sides.length > 0 && <MenuSeparator />}
                  <MenuItem icon="plus" onClick={() => void openSideChat(parent, "")}>
                    New Side Chat
                  </MenuItem>
                </MenuContent>
              </Menu>
              {chat !== undefined && <AddToChat chat={chat} title={title} onAdded={focusMain} />}
              <Button size="xs" iconOnly icon="minimize" aria-label="Minimize" onClick={fold} />
              {chat !== undefined && (
                <Button
                  size="xs"
                  iconOnly
                  icon="x"
                  aria-label="Archive Side Chat"
                  onClick={() => {
                    void archiveSideChat(parent, chat.id);
                    focusMain();
                  }}
                />
              )}
            </div>
          </div>
          <div {...props(styles.body)}>
            <SideChatBody
              parent={parent}
              paneId={paneId}
              shown={shown}
              conversation={conversation}
              inputRef={(handle) => {
                sideInput.current = handle;
              }}
            />
          </div>
        </div>
      </Pip>
    </>
  );
}

function SideChatBody({
  parent,
  paneId,
  shown,
  conversation: Conversation,
  inputRef,
}: {
  readonly parent: SessionId;
  readonly paneId: PaneId;
  readonly shown: SideChatShown;
  readonly conversation: SideChatConversation;
  readonly inputRef: (handle: ComposerEditorHandle | null) => void;
}): ReactNode {
  if (shown.kind === "chat") {
    return <Conversation key={shown.id} paneId={paneId} sessionId={shown.id} inputRef={inputRef} />;
  }

  if (shown.kind === "starting") {
    return (
      <div {...props(styles.first)}>
        <span {...props(text.sm, styles.starting)}>
          <Spinner />
          Starting the side chat
        </span>
      </div>
    );
  }

  return <FirstQuestion parent={parent} error={shown.error} question={shown.question} />;
}

/** A side chat not yet started: its first question starts it. */
function FirstQuestion({
  parent,
  error,
  question,
}: {
  readonly parent: SessionId;
  readonly error: string | null;
  readonly question: string;
}): ReactElement {
  const [draft, setDraft] = useState(question);

  const submit = (): void => {
    if (draft.trim() !== "") void startSideChat(parent, draft.trim());
  };

  return (
    <form
      {...props(styles.first)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p {...props(text.sm, styles.note)}>
        Ask about this chat while it works. Side chats read and search, but don't edit files.
      </p>
      {error !== null && <p {...props(text.sm, styles.error)}>{error}</p>}
      <div {...props(styles.field)}>
        <textarea
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- opening a side chat is asking to type in it
          autoFocus
          aria-label="Side chat question"
          rows={2}
          value={draft}
          placeholder="Ask on the side"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          {...props(text.sm, styles.input)}
        />
        <Button
          type="submit"
          size="xs"
          variant="solid"
          iconOnly
          icon="arrow-up"
          aria-label="Ask"
          disabled={draft.trim() === ""}
        />
      </div>
    </form>
  );
}

/** Adds the side chat's conversation to the chat's next message, as a chip in its composer. */
function AddToChat({
  chat,
  title,
  onAdded,
}: {
  readonly chat: SessionInfo;
  readonly title: string;
  readonly onAdded: () => void;
}): ReactElement {
  const store = chatStore(chat.id);
  const replied = useWatchSelect(store, (state) => state.value?.messages.some(showsText) === true);

  return (
    <Button
      size="xs"
      disabled={!replied}
      disabledReason="Available after a reply."
      onClick={() => {
        if (addToChat({ reference: sideChatExcerpt(chat.id, title, store.value) })) onAdded();
      }}
    >
      {ADD_TO_CHAT_LABEL}
    </Button>
  );
}

/** The folded window: the side chat's title, a spinner while it works, a dot for a reply you haven't seen. */
function Pill({
  title,
  chat,
  onOpen,
}: {
  readonly title: string;
  readonly chat: SessionInfo | undefined;
  readonly onOpen: () => void;
}): ReactElement {
  const head = chat === undefined ? undefined : mainHead(chat);
  const working = head?.execution.kind === "live";

  return (
    <div {...props(styles.pill)}>
      <Button {...GRIP} size="sm" icon={working ? undefined : "bubble-question"} onClick={onOpen}>
        {working && <Spinner />}
        <span {...props(styles.pillTitle)}>{title}</span>
        {head?.unread === true && <span aria-label="New reply" {...props(styles.dot)} />}
      </Button>
    </div>
  );
}

/** ⌘J in the active pane: opens the side chat, or folds it when focus is already in it. */
function SideChatShortcut({
  parent,
  onFold,
  onSummoned,
}: {
  readonly parent: SessionId;
  readonly onFold: () => void;
  readonly onSummoned: () => void;
}): null {
  useMountEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const primary = nyte.platform === "darwin" ? event.metaKey : event.ctrlKey;

      if (!primary || event.shiftKey || event.altKey || event.key.toLowerCase() !== "j") return;

      if (event.defaultPrevented) return;
      event.preventDefault();

      const inside =
        event.target instanceof Element &&
        event.target.closest('[role="dialog"][aria-label="Side chat"]') !== null;

      if (inside) {
        onFold();

        return;
      }

      summonSideChat(parent);
      onSummoned();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  return null;
}
