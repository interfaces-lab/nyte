import { availableModels, findModel, modelId } from "../lib/catalog.ts";
import type { Effect } from "../model/effect.ts";
import type { Notice } from "../model/state.ts";
import type { LoginDriver } from "../services/auth.ts";
import { errorNotice, noticeOf } from "./commands.ts";
import { messageOf } from "./runner.ts";
import type { HandlerContext } from "./runner.ts";
import { fallback, selectionOf } from "./session.ts";

type Of<K extends Effect["kind"]> = Extract<Effect, { readonly kind: K }>;

/**
 * A login driver that shows each step in the auth dialog and takes its
 * answers from `login-answer`; `end` releases the dialog's channel.
 */
function dialogDriver(
  dialog: Of<"login">["dialog"],
  context: HandlerContext,
): {
  readonly driver: LoginDriver;
  readonly controller: AbortController;
  readonly end: () => void;
} {
  const { dispatch, scope } = context;
  const controller = new AbortController();
  let pending: PromiseWithResolvers<string> | null = null;

  const ask = (): Promise<string> => {
    pending = Promise.withResolvers();

    return pending.promise;
  };

  scope.logins.set(dialog, {
    dialog,
    answer: (code) => pending?.resolve(code),
    cancel: () => controller.abort(),
  });

  const driver: LoginDriver = {
    signal: controller.signal,
    open(url, code) {
      dispatch({
        kind: "loaded",
        dialog,
        data: { kind: "auth", step: { kind: "link", url, code: code ?? null } },
      });
    },
    paste(message, secret) {
      dispatch({
        kind: "loaded",
        dialog,
        data: { kind: "auth", step: { kind: "secret", prompt: message, masked: secret } },
      });

      return ask();
    },
    choose(message, options) {
      dispatch({
        kind: "loaded",
        dialog,
        data: { kind: "auth", step: { kind: "choose", prompt: message, options } },
      });

      return ask();
    },
    progress(message) {
      dispatch({
        kind: "loaded",
        dialog,
        data: { kind: "auth", step: { kind: "waiting", message } },
      });
    },
  };

  return {
    driver,
    controller,
    end: () => {
      controller.abort();
      scope.logins.delete(dialog);
    },
  };
}

export async function login(effect: Of<"login">, context: HandlerContext): Promise<void> {
  const { dispatch, ports } = context;
  const { driver, controller, end } = dialogDriver(effect.dialog, context);

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
    end();
  }
}

export async function mcpLogin(effect: Of<"mcp-login">, context: HandlerContext): Promise<void> {
  const { dispatch, ports } = context;
  const { driver, controller, end } = dialogDriver(effect.dialog, context);

  try {
    await ports.host.mcpLogin(effect.workspace, effect.server, driver);
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: noticeOf(context, "ok", `Signed in to ${effect.server}.`),
    });
  } catch (error) {
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: controller.signal.aborted
        ? noticeOf(context, "info", "Sign-in cancelled.")
        : errorNotice(context, error),
    });
  } finally {
    end();
  }
}

export async function mcpAction(effect: Of<"mcp-action">, context: HandlerContext): Promise<void> {
  const { dispatch, ports } = context;
  const outcome = await ports.host.mcpAction(effect.workspace, effect.server, effect.action);

  switch (outcome.kind) {
    case "updated":
      dispatch({
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "mcp", workspace: effect.workspace } },
      });

      return;
    case "missing":
      dispatch({
        kind: "inform",
        tone: "warning",
        text: `No MCP server is named ${effect.server}`,
      });

      return;
    case "invalid":
      dispatch({ kind: "inform", tone: "warning", text: outcome.message });

      return;
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

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

export async function selectAccount(
  effect: Of<"select-account">,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports } = context;

  try {
    await ports.host.selectAccount(effect.provider, effect.account);
    dispatch({
      kind: "op-finished",
      op: "auth",
      notice: await afterCredentials(context, "select", effect.provider, `Using ${effect.label}.`),
    });
  } catch (error) {
    dispatch({ kind: "op-finished", op: "auth", notice: errorNotice(context, error) });
  }
}

async function afterCredentials(
  context: HandlerContext,
  action: "login" | "logout" | "select",
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

async function recoverModel(
  context: HandlerContext,
  action: "login" | "logout" | "select",
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
