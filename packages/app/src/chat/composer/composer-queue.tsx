import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { MessageId, UserContent } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { deliveryChoices } from "./composer-keys.ts";
import { UserMessageText, messageImages } from "../transcript/message-content.tsx";
import { contentDraftText } from "../../references/message-references.ts";
import { composerStyles } from "./composer.stylex.ts";
import type { PendingRowAction } from "./composer-session.ts";

interface ComposerQueueProps {
  readonly pending: readonly UserMessage[];
  readonly unsent: readonly UserMessage[];
  readonly expired: readonly MessageId[];
  readonly rowActions: ReadonlyMap<string, PendingRowAction>;
  readonly editingId: string | undefined;
  readonly canEdit: boolean;
  readonly editBlocked: string | undefined;
  readonly enterSteers: boolean;
  readonly mac: boolean;
  readonly onEdit: (message: UserMessage) => void;
  readonly onSteer: (message: UserMessage) => void;
  /** Moves the message right after `after`, or first when it is null. */
  readonly onMove: (message: UserMessage, after: MessageId | null) => void;
  readonly onCancel: (message: UserMessage) => void;
  readonly onRemoveUnsent: (message: UserMessage) => void;
  readonly onResend: (message: UserMessage) => void;
  readonly onEditBlocked: (reason: string) => void;
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

export function ComposerQueue({
  pending,
  unsent,
  expired,
  rowActions,
  editingId,
  canEdit,
  editBlocked,
  enterSteers,
  mac,
  onEdit,
  onSteer,
  onMove,
  onCancel,
  onRemoveUnsent,
  onResend,
  onEditBlocked,
  onReturn,
}: ComposerQueueProps): ReactElement | null {
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<UserMessage["id"]>();
  const moving = useRef<UserMessage["id"]>(undefined);
  const count = pending.length + unsent.length;
  const order = pending.map((item) => item.id).join(" ");

  // oxlint-disable-next-line nyte-code/no-direct-effect -- keeps DOM focus on a row moved by keyboard: reordering reinserts rows, which drops focus.
  useLayoutEffect(() => {
    const id = moving.current;

    if (id === undefined || document.activeElement !== document.body) return;
    moving.current = undefined;
    const row = listRef.current?.querySelector(`[data-queue-row="${CSS.escape(id)}"]`);

    if (row instanceof HTMLElement) row.focus({ preventScroll: true });
  }, [order]);

  if (count === 0) return null;

  const keys = [...pending, ...unsent].map((item) => item.id);
  const focusKey = active !== undefined && keys.includes(active) ? active : keys[0];
  const deleteKey = mac ? "Meta+Backspace" : "Control+Delete";

  const unsentDescription = `${mac ? "Command+Backspace" : "Ctrl+Delete"} removes. Escape returns to the composer.`;
  const moveKey = mac ? "Option" : "Alt";
  const description = `Enter steers. Space or Right Arrow edits. ${moveKey}+Up Arrow or ${moveKey}+Down Arrow moves. ${unsentDescription}`;

  const placeAfter = (item: UserMessage, step: -1 | 1): MessageId | null | undefined => {
    const index = pending.findIndex((queued) => queued.id === item.id);

    if (index < 0) return undefined;

    if (step === 1) return pending[index + 1]?.id;

    return index === 0 ? undefined : (pending[index - 2]?.id ?? null);
  };

  const release = (button: Element): void => {
    if (button === document.activeElement) onReturn();
  };

  const keyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: UserMessage,
    unsentRow: boolean,
  ): void => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;

    if (!unsentRow && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const action = rowActions.get(item.id);
      const after = placeAfter(item, event.key === "ArrowUp" ? -1 : 1);

      if (
        event.repeat ||
        after === undefined ||
        editingId === item.id ||
        action?.kind === "sending" ||
        action?.kind === "cancelling"
      )
        return;
      moving.current = item.id;
      onMove(item, after);

      return;
    }

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

    if (unsentRow) {
      if (event.key !== "Enter" || !expired.includes(item.id)) return;
      event.preventDefault();
      onReturn();
      onResend(item);

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onReturn();

      if (item.delivery !== deliveryChoices.steer) onSteer(item);

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
          const above = placeAfter(item, -1);
          const below = placeAfter(item, 1);

          return (
            <div
              role="listitem"
              key={item.id}
              data-queue-row={item.id}
              tabIndex={focusKey === item.id ? 0 : -1}
              aria-keyshortcuts={`ArrowUp ArrowDown Alt+ArrowUp Alt+ArrowDown Enter Space ArrowRight Escape ${deleteKey}`}
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
                      aria-label="Steer"
                      title="Sends without stopping the agent"
                      onClick={(event) => {
                        release(event.currentTarget);
                        onSteer(item);
                      }}
                    />
                  )}
                  {above !== undefined && (
                    <Button
                      iconOnly
                      icon="arrow-up"
                      aria-label="Move Up"
                      onClick={(event) => {
                        release(event.currentTarget);
                        onMove(item, above);
                      }}
                    />
                  )}
                  {below !== undefined && (
                    <Button
                      iconOnly
                      icon="arrow-down"
                      aria-label="Move Down"
                      onClick={(event) => {
                        release(event.currentTarget);
                        onMove(item, below);
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
          const retrying = row.status.kind === "unsent" ? row.status.retrying : null;
          const stopped = expired.includes(row.id);

          const reason =
            retrying === null || /[.!?]$/u.test(retrying.reason)
              ? (retrying?.reason ?? "")
              : `${retrying.reason}.`;

          return (
            <div
              role="listitem"
              key={row.id}
              data-queue-row={row.id}
              tabIndex={focusKey === row.id ? 0 : -1}
              aria-keyshortcuts={`ArrowUp ArrowDown ${stopped ? "Enter " : ""}Escape ${deleteKey}`}
              aria-description={stopped ? `Enter sends. ${unsentDescription}` : unsentDescription}
              onFocus={() => setActive(row.id)}
              onKeyDown={(event) => keyDown(event, row, true)}
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
                    {stopped ? `Couldn't send: ${reason}` : `Couldn't send: ${reason} Retrying…`}
                  </span>
                )}
              </div>
              <div {...props(composerStyles.queueActions)}>
                {stopped && (
                  <Button
                    iconOnly
                    icon="arrow-up"
                    aria-label="Send queued message"
                    onClick={(event) => {
                      release(event.currentTarget);
                      onResend(row);
                    }}
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
