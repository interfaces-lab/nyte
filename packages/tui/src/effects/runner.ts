/**
 * Executes effects. One handler per `Effect["kind"]` in an exhaustive record,
 * so a new effect without a handler fails the build. Every handler's failure
 * is caught here, written to the crash log and answered with an
 * `effect-failed` outcome: no effect can fail silently or kill a loop.
 */
import type { Effect } from "../model/effect.ts";
import type { Msg } from "../model/msg.ts";
import type { State } from "../model/state.ts";
import { login, loginAnswer, logout } from "./auth.ts";
import { boot } from "./boot.ts";
import type { BootOptions } from "./boot.ts";
import {
  answer,
  applySetting,
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
  readPreview,
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
import { follow } from "./session.ts";
import { submit } from "./submit.ts";

export interface Runner {
  run(effect: Effect): void;
  /** Starts the boot sequence as a tracked task; its failures reach the log like any effect's. */
  boot(options: BootOptions): void;
  /** Resolves when the `exit` effect ran, with the code it carried. */
  readonly exited: Promise<{ readonly code: number }>;
  /** Resolves when every started effect settled; tests await it instead of sleeping. */
  settled(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RunnerContext {
  readonly ports: Ports;
  readonly dispatch: (msg: Msg) => void;
  /** The latest state, for re-checks right before an SDK call. Read-only. */
  readonly read: () => State;
  readonly signal: AbortSignal;
}

/** What a handler receives: the runner's context plus the state it keeps between effects. */
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
    boot: (options) => track("boot", () => boot(options, handlerContext)),
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

/** Correlates `effect.kind` with its handler without a cast (one generic hop). */
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
  notify,
  exit,
  "refresh-workspace": refreshWorkspaceFacts,
  "run-command": runCommand,
  "stop-task": stopTask,
  "apply-setting": applySetting,
  "login-answer": loginAnswer,
  "list-directory": listDirectory,
  "read-preview": readPreview,
};
