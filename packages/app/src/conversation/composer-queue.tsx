import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { UserContent } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { trayStyles } from "../theme/tray.stylex.ts";
import { deliveryChoices } from "./composer-keys.ts";
import { UserMessageText, messageImages } from "./message-content.tsx";
import { contentDraftText } from "./message-references.ts";
import { composerStyles } from "./composer.stylex.ts";

/** What one queued row is doing right now; absent means idle. */
export type PendingRowAction =
  | { readonly kind: "cancelling" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly message: string };

interface ComposerQueueProps {
  /** Follow-ups the host holds for the live run. */
  readonly pending: readonly UserMessage[];
  /** Sends the host has not taken yet. */
  readonly unsent: readonly UserMessage[];
  readonly rowActions: ReadonlyMap<string, PendingRowAction>;
  /** The queued message the composer is editing. */
  readonly editingId: string | undefined;
  /** A row can go into the composer for editing now. */
  readonly canEdit: boolean;
  /** Why editing is blocked, when the composer can say. */
  readonly editBlocked: string | undefined;
  /** Enter on the empty composer steers with the first queued follow-up. */
  readonly enterSteers: boolean;
  readonly mac: boolean;
  readonly onEdit: (message: UserMessage) => void;
  readonly onSendNow: (message: UserMessage) => void;
  readonly onCancel: (message: UserMessage) => void;
  readonly onRemoveUnsent: (message: UserMessage) => void;
  readonly onSendUnsentNow: (message: UserMessage) => void;
  /** A row refused an edit; the composer says why. */
  readonly onEditBlocked: (reason: string) => void;
  /** Focus goes back to the editor. */
  readonly onReturn: () => void;
}

function QueuedMessageContent({ content }: { readonly content: UserContent }): ReactElement {
  const words = contentDraftText(content);

  if (words === "") {
    const imageCount = messageImages(content).length;
    const summary = imageCount === 1 ? "1 image" : `${String(imageCount)} images`;

    return (
      <span title={summary} {...props(composerStyles.queuePreview)}>
        {summary}
      </span>
    );
  }

  return (
    <span title={words} {...props(composerStyles.queuePreview)}>
      <UserMessageText text={words} />
    </span>
  );
}

/**
 * The queued follow-ups above the composer, one keyboard stop: arrows move
 * between rows, Enter sends one now, Space or Right Arrow edits it, the
 * platform delete chord removes it and Escape returns to the editor. A row
 * action that holds focus hands it to the editor before its button goes away.
 */
export function ComposerQueue({
  pending,
  unsent,
  rowActions,
  editingId,
  canEdit,
  editBlocked,
  enterSteers,
  mac,
  onEdit,
  onSendNow,
  onCancel,
  onRemoveUnsent,
  onSendUnsentNow,
  onEditBlocked,
  onReturn,
}: ComposerQueueProps): ReactElement | null {
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<UserMessage["id"]>();
  const count = pending.length + unsent.length;

  if (count === 0) return null;

  const keys = [...pending, ...unsent].map((item) => item.id);
  const focusKey = active !== undefined && keys.includes(active) ? active : keys[0];
  const deleteKey = mac ? "Meta+Backspace" : "Control+Delete";

  const description = `Enter sends now. Space or Right Arrow edits. ${mac ? "Command+Backspace" : "Ctrl+Delete"} removes. Escape returns to the composer.`;

  const release = (button: Element): void => {
    if (button === document.activeElement) onReturn();
  };

  const keyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: UserMessage,
    unsentRow: boolean,
  ): void => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const rows = [...(listRef.current?.querySelectorAll("[data-queue-row]") ?? [])];
      const index = rows.findIndex((row) => row === event.currentTarget);
      const step = event.key === "ArrowUp" ? -1 : 1;
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];

      if (next instanceof HTMLElement) next.focus({ preventScroll: true });

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onReturn();

      return;
    }

    if (event.repeat) return;
    const action = rowActions.get(item.id);

    if (editingId === item.id || action?.kind === "sending" || action?.kind === "cancelling")
      return;

    const remove = mac
      ? event.metaKey && event.key === "Backspace"
      : event.ctrlKey && event.key === "Delete";

    if (remove) {
      event.preventDefault();
      onReturn();

      if (unsentRow) onRemoveUnsent(item);
      else onCancel(item);

      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

    if (event.key === "Enter") {
      event.preventDefault();
      onReturn();

      if (unsentRow) onSendUnsentNow(item);
      else if (item.delivery !== deliveryChoices.steer) onSendNow(item);

      return;
    }

    if (event.key !== " " && event.key !== "ArrowRight") return;
    event.preventDefault();

    if (editBlocked === undefined) onEdit(item);
    else onEditBlocked(editBlocked);
  };

  return (
    <section aria-label="Queued messages" {...props(trayStyles.surface)}>
      <div {...props(trayStyles.header)}>
        <span {...props(trayStyles.title)}>
          {String(count)} queued {count === 1 ? "message" : "messages"}
          {enterSteers && <span {...props(composerStyles.queueHint)}> · Enter to steer</span>}
        </span>
      </div>
      <div ref={listRef} role="list" {...props(trayStyles.list, composerStyles.queueList)}>
        {pending.map((item) => {
          const action = rowActions.get(item.id);
          const editingThis = editingId === item.id;
          const busyRow = action?.kind === "cancelling" || action?.kind === "sending";

          return (
            <div
              role="listitem"
              key={item.id}
              data-queue-row={item.id}
              tabIndex={focusKey === item.id ? 0 : -1}
              aria-keyshortcuts={`ArrowUp ArrowDown Enter Space ArrowRight Escape ${deleteKey}`}
              aria-description={description}
              onFocus={() => setActive(item.id)}
              onKeyDown={(event) => keyDown(event, item, false)}
              data-editing={editingThis}
              data-error={action?.kind === "failed"}
              {...props(composerStyles.queueRow)}
            >
              <div {...props(composerStyles.queueMessage)}>
                <QueuedMessageContent
                  content={item.source.kind === "action" ? item.source.label : item.content}
                />
                {action?.kind === "cancelling" && (
                  <span {...props(text.xs, composerStyles.queuedState)}>Cancelling…</span>
                )}
                {action?.kind === "failed" && (
                  <span
                    role="alert"
                    {...props(
                      text.xs,
                      intent.danger,
                      composerStyles.queuedState,
                      composerStyles.queuedError,
                    )}
                  >
                    {action.message}
                  </span>
                )}
              </div>
              {!busyRow && !editingThis && (
                <div {...props(composerStyles.queueActions)}>
                  {item.source.kind !== "action" && (
                    <Button
                      iconOnly
                      icon="pencil"
                      aria-label="Edit queued message"
                      disabled={!canEdit}
                      disabledReason={editBlocked}
                      onClick={() => onEdit(item)}
                    />
                  )}
                  {item.delivery !== deliveryChoices.steer && (
                    <Button
                      iconOnly
                      icon="arrow-up"
                      aria-label="Add to next response"
                      onClick={(event) => {
                        release(event.currentTarget);
                        onSendNow(item);
                      }}
                    />
                  )}
                  <Button
                    iconOnly
                    icon="trash"
                    aria-label="Remove queued message"
                    onClick={(event) => {
                      release(event.currentTarget);
                      onCancel(item);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
        {unsent.map((row) => {
          const editingThis = editingId === row.id;
          const retrying = row.status.kind === "unsent" ? row.status.retrying : null;

          return (
            <div
              role="listitem"
              key={row.id}
              data-queue-row={row.id}
              tabIndex={focusKey === row.id ? 0 : -1}
              aria-keyshortcuts={`ArrowUp ArrowDown Enter Space ArrowRight Escape ${deleteKey}`}
              aria-description={description}
              onFocus={() => setActive(row.id)}
              onKeyDown={(event) => keyDown(event, row, true)}
              data-editing={editingThis}
              data-error={retrying !== null}
              {...props(composerStyles.queueRow)}
            >
              <div {...props(composerStyles.queueMessage)}>
                <QueuedMessageContent
                  content={row.source.kind === "action" ? row.source.label : row.content}
                />
                {retrying !== null && (
                  <span
                    role="alert"
                    {...props(
                      text.xs,
                      intent.danger,
                      composerStyles.queuedState,
                      composerStyles.queuedError,
                    )}
                  >
                    Couldn't send: {retrying.reason}. Retrying…
                  </span>
                )}
              </div>
              {!editingThis && (
                <div {...props(composerStyles.queueActions)}>
                  {row.source.kind !== "action" && row.delivery !== deliveryChoices.steer && (
                    <Button
                      iconOnly
                      icon="pencil"
                      aria-label="Edit queued message"
                      disabled={!canEdit}
                      disabledReason={editBlocked}
                      onClick={() => onEdit(row)}
                    />
                  )}
                  <Button
                    iconOnly
                    icon="trash"
                    aria-label="Remove queued message"
                    onClick={(event) => {
                      release(event.currentTarget);
                      onRemoveUnsent(row);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
