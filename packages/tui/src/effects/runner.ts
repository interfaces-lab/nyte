import type { Effect } from "../model/effect.ts";
import type { Msg } from "../model/msg.ts";
import type { State } from "../model/state.ts";
import { login, loginAnswer, logout, mcpAction, mcpLogin, selectAccount } from "./auth.ts";
import { boot } from "./boot.ts";
import type { BootOptions } from "./boot.ts";
import {
  answer,
  applySetting,
  checkTrust,
  setTrust,
  changeDirectory,
  compact,
  configure,
  move,
  refreshWorkspaceFacts,
  reload,
  revise,
  runCommand,
  stopRun,
  stopTask,
  withdraw,
} from "./commands.ts";
import {
  composer,
  copy,
  exit,
  listDirectory,
  load,
  notify,
  openEditor,
  openExternal,
  readClipboard,
  readDialogClipboard,
  readPreview,
  resolveMention,
  resolvePaste,
  scroll,
  selfUpdate,
  shellStart,
  shellStop,
  writeSettings,
} from "./local.ts";
import type { Ports } from "./ports.ts";
import { createScope } from "./scope.ts";
import type { Scope } from "./scope.ts";
import { follow, loadEarlier } from "./session.ts";
import { submit } from "./submit.ts";

export interface Runner {
  run(effect: Effect): void;
  /** Boots once; `opened` settles when the host is reachable, or rejects when it can't open. */
  boot(options: BootOptions, opened: Promise<void>): void;
  readonly exited: Promise<{ readonly code: number }>;
  settled(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RunnerContext {
  readonly ports: Ports;
  readonly dispatch: (msg: Msg) => void;
  readonly read: () => State;
  readonly signal: AbortSignal;
}

export interface HandlerContext extends RunnerContext {
  readonly scope: Scope;
}

type Handlers = {
  readonly [K in Effect["kind"]]: (
    effect: Extract<Effect, { readonly kind: K }>,
    context: HandlerContext,
  ) => Promise<void>;
};

export function createRunner(context: RunnerContext): Runner {
  const scope = createScope();
  const handlerContext: HandlerContext = { ...context, scope };
  const inFlight = new Set<Promise<void>>();

  const track = (name: string, work: () => Promise<void>): void => {
    const task: Promise<void> = work()
      .catch((error: unknown) => {
        context.ports.log.write("effect", error);
        context.dispatch({ kind: "effect-failed", effect: name, message: messageOf(error) });
      })
      .finally(() => {
        inFlight.delete(task);
      });

    inFlight.add(task);
  };

  return {
    run: (effect) => track(effect.kind, () => invoke(HANDLERS, effect, handlerContext)),
    boot: (options, opened) => track("boot", () => boot(options, opened, handlerContext)),
    exited: scope.exit.promise,
    async settled() {
      while (inFlight.size > 0) await Promise.allSettled(inFlight);
    },
    async dispose() {
      scope.followed?.controller.abort();
      scope.followed = null;

      for (const channel of scope.logins.values()) channel.cancel();

      for (const shell of scope.shells.values()) shell.stop();
      await Promise.allSettled([...inFlight, ...scope.watches, ...shellsDone(scope)]);
    },
  };
}

export function invoke<K extends Effect["kind"]>(
  handlers: Handlers,
  effect: Extract<Effect, { readonly kind: K }>,
  context: HandlerContext,
): Promise<void> {
  const handler: Handlers[K] = handlers[effect.kind];

  return handler(effect, context);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellsDone(scope: Scope): readonly Promise<void>[] {
  return [...scope.shells.values()].map((shell) => shell.done);
}

export const HANDLERS: Handlers = {
  follow: (effect, context) => follow(effect.target, effect.announce, context),
  "load-earlier": loadEarlier,
  send: (effect, context) => submit(effect.submission, effect.delivery, context),
  revise,
  withdraw,
  "stop-run": stopRun,
  answer,
  move,
  configure,
  "shell-start": shellStart,
  "shell-stop": shellStop,
  composer,
  scroll,
  load,
  "resolve-paste": resolvePaste,
  "read-clipboard": readClipboard,
  "read-dialog-clipboard": readDialogClipboard,
  copy,
  "open-editor": openEditor,
  "open-external": openExternal,
  "write-settings": writeSettings,
  "change-directory": changeDirectory,
  reload,
  compact,
  "self-update": selfUpdate,
  login,
  logout,
  "select-account": selectAccount,
  notify,
  exit,
  "refresh-workspace": refreshWorkspaceFacts,
  "run-command": runCommand,
  "stop-task": stopTask,
  "apply-setting": applySetting,
  "check-trust": checkTrust,
  "set-trust": setTrust,
  "login-answer": loginAnswer,
  "mcp-action": mcpAction,
  "mcp-login": mcpLogin,
  "list-directory": listDirectory,
  "resolve-mention": resolveMention,
  "read-preview": readPreview,
};
