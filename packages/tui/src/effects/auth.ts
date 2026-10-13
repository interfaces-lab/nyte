/**
 * Sign in and out through the host. The login's steps reach the auth dialog
 * as `loaded` outcomes; what the user types or picks comes back through the
 * `login-answer` effect on the runner's channel for that dialog. Credential
 * changes recover the model selection: a model
 * that vanished is replaced by the first the provider still serves.
 */
import { availableModels, findModel, modelId } from "../lib/catalog.ts";
import type { Effect } from "../model/effect.ts";
import type { Notice } from "../model/state.ts";
import type { LoginDriver } from "../services/auth.ts";
import { errorNotice, noticeOf } from "./commands.ts";
import { messageOf } from "./runner.ts";
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

    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: await afterCredentials(
        context,
        "login",
        result.provider,
        `Signed in to ${result.name}.`,
      ),
    });
  } catch (error) {
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: controller.signal.aborted
        ? noticeOf(context, "info", "Authentication cancelled.")
        : errorNotice(context, error),
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

    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: await afterCredentials(
        context,
        "logout",
        result.provider,
        `Signed out of ${result.name}.`,
      ),
    });
  } catch (error) {
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: errorNotice(context, error),
    });
  }
}

/**
 * The notice a credential change ends with: what was done, then what became
 * of the selected model. A failed catalog refresh keeps the sign-in and says
 * how to retry.
 */
async function afterCredentials(
  context: HandlerContext,
  action: "login" | "logout",
  provider: string,
  done: string,
): Promise<Notice> {
  try {
    if (action === "login") await context.ports.host.refreshModels(provider);
    const recovered = await recoverModel(context, action, provider);

    return recovered === null
      ? noticeOf(context, "ok", done)
      : noticeOf(context, recovered.tone, `${done}\n${recovered.text}`);
  } catch (error) {
    return noticeOf(
      context,
      "warning",
      `${done}\nModel selection could not refresh: ${messageOf(error)}. Use /model to retry.`,
    );
  }
}

/** After a credential change: re-list the catalog, and if the selected model is gone, pick the first that remains. */
async function recoverModel(
  context: HandlerContext,
  action: "login" | "logout",
  provider: string,
): Promise<{ readonly tone: "ok" | "warning"; readonly text: string } | null> {
  const { dispatch, ports, read, scope } = context;
  const catalog = await ports.host.listModels();
  const generation = (scope.catalogGeneration += 1);
  dispatch({ kind: "catalog", generation, catalog });
  const followed = scope.followed;

  if (followed === null) return null;
  const state = read();
  const current = selectionOf(state, followed.id) ?? fallback(state);
  const models = availableModels(catalog);

  if (findModel(models, current.model) !== undefined) return null;

  if (action === "logout" && current.model.provider !== provider) return null;

  const candidates =
    action === "login" ? models.filter((model) => model.ref.provider === provider) : models;

  const first = candidates[0];

  if (first === undefined)
    return {
      tone: "warning",
      text:
        models.length === 0
          ? "No authenticated models available. /login connects a provider; /model refreshes the catalog."
          : "No models available for this provider. /model selects another.",
    };

  const result = await followed.configurator.request({ model: first.ref });

  if (result.kind === "failed") throw new Error(result.message);

  return { tone: "ok", text: `Model: ${modelId(first.ref)}` };
}
