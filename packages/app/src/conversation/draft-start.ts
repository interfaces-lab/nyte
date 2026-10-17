import { SdkError } from "@nyte-ai/sdk";
import type { Connection } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { errorMessage } from "../errors.ts";
import type { PaneActions } from "../layout/pane-context.tsx";
import type { DraftStatus, SessionViewStateStore } from "../layout/session-view-state.ts";
import { readStartCatalog, selectedWorkspaceId } from "../queries.ts";
import { connected, sessionWatch } from "../sdk.tsx";
import { selectedModelOption } from "./model-picker-state.ts";
import { startComposerChat } from "./composer-send.ts";
import type { ComposerSendPlan } from "./composer-send.ts";

/** The connection once the host answers, or undefined as soon as the draft stops holding `waiting`. */
async function connectedWhileWaiting(
  store: SessionViewStateStore,
  draftId: string,
  waiting: DraftStatus,
): Promise<Connection | undefined> {
  const withdrawn = Promise.withResolvers<undefined>();

  const stop = store.subscribe(() => {
    if (store.readDraft(draftId)?.status !== waiting) withdrawn.resolve(undefined);
  });

  try {
    return await Promise.race([connected(), withdrawn.promise]);
  } finally {
    stop();
  }
}

/**
 * Starts a held draft's chat with its first message once the host answers,
 * and settles as soon as the send is withdrawn. The draft, not the screen
 * that sent it, owns the send: a remount, a move to another pane or a park
 * changes nothing here, and the chat opens in whichever pane shows the
 * draft when it starts. The model and folder are read once the host
 * answers, so a model the last run recorded but the host no longer lists is
 * refused in place, never sent. The draft's id names the chat, so a retry
 * after a failed start is the same start.
 */
export async function startDraft(
  store: SessionViewStateStore,
  actions: Pick<PaneActions, "openDraftChat">,
  draftId: string,
  waiting: DraftStatus,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
): Promise<void> {
  const connection = await connectedWhileWaiting(store, draftId, waiting);

  if (connection === undefined || !store.commitSend(draftId, waiting)) return;
  const id = asId<"session">(draftId);
  const composer = store.readDraft(draftId)?.composer;

  try {
    const catalog = await readStartCatalog();
    const model = catalog.defaults?.model;

    const listed = selectedModelOption(
      catalog.models.filter((option) => option.listed),
      model,
    );

    if (catalog.models.length === 0) {
      store.failSend(draftId, {
        kind: "refused",
        message: "Connect a provider in Settings to choose a model.",
        fix: undefined,
      });

      return;
    }

    if (model === undefined || listed === undefined) {
      store.failSend(draftId, {
        kind: "refused",
        message:
          model === undefined
            ? "Choose a model to start this chat."
            : `${model.id} isn’t available. Choose another model.`,
        fix: "choose-model",
      });

      return;
    }

    const workspace = selectedWorkspaceId();

    await startComposerChat(
      connection,
      {
        id,
        ...(workspace !== undefined && { workspace }),
        configuration: { model },
      },
      plan,
    );
    await sessionWatch(id)
      .next()
      .catch(() => undefined);
    actions.openDraftChat(draftId, id);
  } catch (cause: unknown) {
    const invalid = cause instanceof SdkError && cause.code === "invalid";

    const started = await connection
      .session(id)
      .info()
      .then(
        () => true,
        () => false,
      );

    if (started) {
      actions.openDraftChat(draftId, id, invalid ? composer : undefined);

      return;
    }

    store.failSend(
      draftId,
      invalid
        ? { kind: "refused", message: cause.message, fix: undefined }
        : { kind: "failed", cause: errorMessage(cause) },
    );
  }
}
