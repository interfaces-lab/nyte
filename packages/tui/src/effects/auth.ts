/**
 * Sign in and out through the host. The login's steps reach the auth dialog
 * as `loaded` outcomes; what the user types or picks comes back through the
 * `login-answer` effect on the runner's channel for that dialog. Credential
 * changes recover the model selection the way the old shell did: a model
 * that vanished is replaced by the first the provider still serves.
 */
import { availableModels, findModel } from "../lib/catalog.ts";
import type { Effect } from "../model/effect.ts";
import type { LoginDriver } from "../services/auth.ts";
import { noticeOf } from "./commands.ts";
import type { HandlerContext } from "./runner.ts";
import { fallback, selectionOf } from "./session.ts";

type Of<K extends Effect["kind"]> = Extract<Effect, { readonly kind: K }>;

export async function login(effect: Of<"login">, context: HandlerContext): Promise<void> {
  const { dispatch, ports, scope } = context;
  const controller = new AbortController();
  let pending: PromiseWithResolvers<string> | null = null;

  const ask = (): Promise<string> => {
    pending = Promise.withResolvers();

    return pending.promise;
  };

  scope.logins.set(effect.dialog, {
    dialog: effect.dialog,
    answer: (code) => pending?.resolve(code),
    cancel: () => controller.abort(),
  });

  const driver: LoginDriver = {
    signal: controller.signal,
    open(url, code) {
      ports.terminal.open(url);
      dispatch({
        kind: "loaded",
        dialog: effect.dialog,
        data: { kind: "auth", step: { kind: "link", url, code: code ?? null } },
      });
    },
    paste(message, secret) {
      dispatch({
        kind: "loaded",
        dialog: effect.dialog,
        data: { kind: "auth", step: { kind: "secret", prompt: message, masked: secret } },
      });

      return ask();
    },
    choose(message, options) {
      dispatch({
        kind: "loaded",
        dialog: effect.dialog,
        data: { kind: "auth", step: { kind: "choose", prompt: message, options } },
      });

      return ask();
    },
    progress(message) {
      dispatch({
        kind: "loaded",
        dialog: effect.dialog,
        data: { kind: "auth", step: { kind: "waiting", message } },
      });
    },
  };

  try {
    const result = await ports.host.login(effect.provider, driver);
    await ports.host.refreshModels(result.provider);
    await recoverModel(context, "login", result.provider);
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: noticeOf(context, "info", `Signed in to ${result.name}.`),
    });
  } catch (error) {
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: controller.signal.aborted
        ? noticeOf(context, "info", "Authentication cancelled.")
        : noticeOf(context, "error", error instanceof Error ? error.message : String(error)),
    });
  } finally {
    controller.abort();
    scope.logins.delete(effect.dialog);
  }
}

/** The auth dialog's answer to the step it showed; null cancels the login. */
export async function loginAnswer(
  effect: Of<"login-answer">,
  context: HandlerContext,
): Promise<void> {
  const channel = context.scope.logins.get(effect.dialog);

  if (channel === undefined) return;

  if (effect.answer === null) channel.cancel();
  else channel.answer(effect.answer);
}

export async function logout(effect: Of<"logout">, context: HandlerContext): Promise<void> {
  const { dispatch, ports } = context;

  const driver: LoginDriver = {
    signal: context.signal,
    open: () => undefined,
    paste: () => Promise.reject(new Error("Logout asks nothing.")),
    choose: () => Promise.reject(new Error("Logout asks nothing.")),
    progress: () => undefined,
  };

  try {
    const result = await ports.host.logout(effect.provider === "" ? null : effect.provider, driver);
    await recoverModel(context, "logout", result.provider);
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: noticeOf(context, "info", `Signed out of ${result.name}.`),
    });
  } catch (error) {
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: noticeOf(context, "error", error instanceof Error ? error.message : String(error)),
    });
  }
}

/** After a credential change: re-list the catalog, and if the selected model is gone, pick the first that remains. */
async function recoverModel(
  context: HandlerContext,
  action: "login" | "logout",
  provider: string,
): Promise<void> {
  const { dispatch, ports, read, scope } = context;
  const catalog = await ports.host.listModels();
  const generation = (scope.catalogGeneration += 1);
  dispatch({ kind: "catalog", generation, catalog });
  const followed = scope.followed;

  if (followed === null) return;
  const state = read();
  const current = selectionOf(state, followed.id) ?? fallback(state);
  const models = availableModels(catalog);

  if (findModel(models, current.model) !== undefined) return;

  if (action === "logout" && current.model.provider !== provider) return;

  const candidates =
    action === "login" ? models.filter((model) => model.ref.provider === provider) : models;

  const first = candidates[0];

  if (first === undefined) {
    dispatch({
      kind: "inform",
      tone: "warning",
      text:
        models.length === 0
          ? "No authenticated models available. /login connects a provider; /model refreshes the catalog."
          : "No models available for this provider. /model selects another.",
    });

    return;
  }

  await followed.configurator.request({ model: first.ref });
}
