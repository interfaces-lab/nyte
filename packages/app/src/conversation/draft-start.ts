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
  const draft = store.readDraft(draftId);
  const composer = draft?.composer;

  try {
    const catalog = await readStartCatalog();
    const model = draft?.choice?.model ?? catalog.defaults?.model;

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
        configuration: { model, thinking: draft?.choice?.thinking },
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
