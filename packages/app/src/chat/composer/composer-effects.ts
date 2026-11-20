import { flushSync } from "react-dom";
import type { Delivery, HeldMessage, MessageId, ReceiptId, SessionId } from "@nyte-ai/sdk";
import { errorMessage } from "../../contract/errors.ts";
import { connection, currentConnection, installedLive } from "../../data/connection.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import type { SessionViewStateStore } from "../../panes/session-view-state.ts";
import type { ComposerSubmission } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import type { RefusedSend } from "@nyte-ai/sdk/client";
import type { ComposerImageAttachment } from "../../panes/session-view-state.ts";
import { messageFiles } from "../transcript/message-content.tsx";
import type { MessageFile } from "../transcript/message-content.tsx";
import { handedOff, keptSending, replayedDraft, shownDraft } from "./composer-draft.ts";
import { contentDraftText } from "../../references/message-references.ts";
import { readPrompts } from "./composer-history.ts";
import { deliverEdit } from "./composer-send.ts";
import { CLOSED_SESSION, EDIT_ENDED_NOTICES, stepSession } from "./composer-session.ts";
import type {
  ComposerSession,
  ComposerSessionEffect,
  ComposerSessionEvent,
  SessionStep,
} from "./composer-session.ts";

export interface ComposerPorts {
  readonly sessionId: SessionId;
  readonly drafts: SessionViewStateStore;
  readonly revised: () => void;
}

type SaveEffect = Extract<ComposerSessionEffect, { readonly kind: "save" }>;

const refusedSends = installedLive((current) => current.refused);

const recovering = new Set<ReceiptId>();

function giveBackRefused(): void {
  for (const refused of refusedSends.read() ?? []) {
    if (recovering.has(refused.id)) continue;
    recovering.add(refused.id);
    void giveBack(refused);
  }
}

async function giveBack(refused: RefusedSend): Promise<void> {
  const drafts = windowTabs.panes().viewState;

  drafts.updateDraft(refused.session, (draft) =>
    keptSending(draft, {
      receipt: refused.id,
      text: contentDraftText(refused.content),
      attachments: [],
    }),
  );

  const files = messageFiles(refused.content).filter((file) => file.mime.startsWith("image/"));
  const read = await Promise.allSettled(files.map(readImage));
  const images = read.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  const lost = files.flatMap((file, index) =>
    read[index]?.status === "rejected" ? [file.name] : [],
  );

  drafts.updateDraft(refused.session, (draft) =>
    replayedDraft(handedOff(draft, refused.id), refused, images, lost),
  );
  drafts.persist();
  currentConnection()?.refused.take(refused.id);
}

async function readImage(file: MessageFile): Promise<ComposerImageAttachment> {
  await using reader = await connection().blob(file.blob);
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  for await (const chunk of reader.chunks()) chunks.push(new Uint8Array(chunk));
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());

  return {
    id: crypto.randomUUID(),
    name: file.name,
    content: { type: "image", data: bytes.toBase64(), mimeType: file.mime },
  };
}

refusedSends.subscribe(giveBackRefused);
giveBackRefused();

type ReadEffect = Extract<ComposerSessionEffect, { readonly kind: "read-prompts" }>;

export function composerSession(ports: ComposerPorts) {
  let state = CLOSED_SESSION;
  const listeners = new Set<() => void>();
  const holds = new Map<number, HeldMessage>();
  let editor: ComposerEditorHandle | null = null;

  const apply = (event: ComposerSessionEvent): SessionStep => {
    const before = ports.drafts.readSession(ports.sessionId).draft;
    const next = stepSession(state, before, event);

    if (next.state !== state) {
      state = next.state;

      for (const listener of listeners) listener();
    }

    if (next.draft !== before) ports.drafts.updateDraft(ports.sessionId, () => next.draft);

    return next;
  };

  const perform = (effects: readonly ComposerSessionEffect[]): Promise<void> =>
    Promise.all(effects.map(run)).then(() => undefined);

  const dispatch = (event: ComposerSessionEvent): boolean => {
    const next = apply(event);
    void perform(next.effects);

    return next.handled;
  };

  const hold = (message: MessageId, token: number): void => {
    const ended = (notice: string): void => {
      dispatch({ kind: "hold-answered", token, answer: { kind: "ended", notice } });
    };

    connection()
      .session(ports.sessionId)
      .hold(message)
      .then(
        (answer) => {
          if (answer.kind !== "held") {
            ended(EDIT_ENDED_NOTICES[answer.kind]);

            return;
          }

          holds.set(token, answer);
          void answer.lost.then((lost) => ended(EDIT_ENDED_NOTICES[lost.kind]));
          dispatch({ kind: "hold-answered", token, answer: { kind: "held" } });
        },
        (cause: unknown) => ended(`Couldn't hold the message: ${errorMessage(cause)}`),
      );
  };

  const release = (token: number): void => {
    void holds.get(token)?.release();
    holds.delete(token);
  };

  const saveEdit = async (effect: SaveEffect): Promise<void> => {
    const held = effect.held === null ? undefined : holds.get(effect.held);

    if (effect.held !== null) holds.delete(effect.held);

    const saved = await deliverEdit({
      sessionId: ports.sessionId,
      submission: effect.submission,
      attachments: shownDraft(ports.drafts.readSession(ports.sessionId).draft).attachments,
      delivery: effect.delivery,
      message: effect.message,
      revise: (content, options) =>
        held !== undefined
          ? held.save(content, options)
          : connection().session(ports.sessionId).revise(effect.message.id, content, options),
    });

    if (held !== undefined) await held.release();
    const next = flushSync(() => apply({ kind: "saved", token: effect.token, saved }));
    await perform(next.effects);
  };

  const readEarlier = (effect: ReadEffect): void => {
    void readPrompts(connection().session(ports.sessionId), effect.history, effect.count).then(
      (history) =>
        dispatch({
          kind: "prompts-read",
          token: effect.token,
          direction: effect.direction,
          history,
        }),
      (cause: unknown) =>
        dispatch({
          kind: "prompts-failed",
          token: effect.token,
          message: `Couldn't read earlier prompts: ${errorMessage(cause)}`,
        }),
    );
  };

  async function run(effect: ComposerSessionEffect): Promise<void> {
    switch (effect.kind) {
      case "hold":
        hold(effect.message, effect.token);

        return;
      case "release":
        release(effect.token);

        return;
      case "save":
        await saveEdit(effect);

        return;
      case "read-prompts":
        readEarlier(effect);

        return;
      case "focus":
        editor?.focus({ preventScroll: effect.preventScroll });

        return;
      case "revised":
        ports.revised();

        return;
      default: {
        const _exhaustive: never = effect;

        return _exhaustive;
      }
    }
  }

  return {
    read: (): ComposerSession => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    editor: (): ComposerEditorHandle | null => editor,
    attach: (handle: ComposerEditorHandle | null): void => {
      editor = handle;
    },
    save: (submission: ComposerSubmission, delivery: Delivery): Promise<void> =>
      perform(apply({ kind: "save", submission, delivery }).effects),
  };
}
