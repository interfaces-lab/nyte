import { errorMessage } from "../lib/format.ts";
import type { Effect } from "../model/effect.ts";
import { login, loginAnswer, logout, mcpAction, mcpLogin, selectAccount } from "./auth.ts";
import { boot } from "./boot.ts";
import type { BootOptions } from "./boot.ts";
import {
  answer,
  applySetting,
  approve,
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
import { createScope } from "./scope.ts";
import type { HandlerContext, LocalHandlerContext, RunnerContext, Scope } from "./scope.ts";
import { follow, loadEarlier, openNew } from "./session.ts";
import { submit } from "./submit.ts";

export interface Runner {
  run(effect: Effect): void;
  /** Boots once the host opens; a host that can't open fails boot. */
  boot(options: BootOptions): void;
  readonly exited: Promise<{ readonly code: number }>;
  settled(): Promise<void>;
  dispose(): Promise<void>;
}

type Handler<K extends Effect["kind"], C> = (
  effect: Extract<Effect, { readonly kind: K }>,
  context: C,
) => Promise<void>;

/** Where an effect runs: a local one at once, without the host; a host one once the host opens. */
type Route<K extends Effect["kind"]> =
  | { readonly kind: "local"; readonly run: Handler<K, LocalHandlerContext> }
  | { readonly kind: "host"; readonly run: Handler<K, HandlerContext> };

type Routes = { readonly [K in Effect["kind"]]: Route<K> };

/**
 * Runs effects: local ones at once, host ones once `context.opened` settles. Host effects run
 * before it settles start in the order they came; a host that can't open drops them, and only
 * boot reports it.
 */
export function createRunner(context: RunnerContext): Runner {
  const scope = createScope();
  const handlerContext: HandlerContext = { ...context, scope };
  const inFlight = new Set<Promise<void>>();
  const reachable = reachableHost(context.opened, context.signal);
  let open = false;

  void reachable.then(
    (reached) => {
      open = reached;
    },
    () => undefined,
  );

  const track = (name: string, work: () => Promise<void>): void => {
    const task: Promise<void> = work()
      .catch((error: unknown) => {
        context.ports.log.write("effect", error);
        context.dispatch({ kind: "effect-failed", effect: name, message: errorMessage(error) });
      })
      .finally(() => {
        inFlight.delete(task);
      });

    inFlight.add(task);
  };

  const invoke = <K extends Effect["kind"]>(
    effect: Extract<Effect, { readonly kind: K }>,
  ): Promise<void> => {
    const route: Route<K> = ROUTES[effect.kind];

    if (route.kind === "local" || open) return route.run(effect, handlerContext);

    return reachable.then(
      (reached) => (reached ? route.run(effect, handlerContext) : undefined),
      () => undefined,
    );
  };

  return {
    run: (effect) => track(effect.kind, () => invoke(effect)),
    boot: (options) =>
      track("boot", async () => {
        if (await reachable) await boot(options, handlerContext);
      }),
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

/** Resolves `true` once the host opens and `false` when the runner stops first; rejects when the host can't open. */
function reachableHost(opened: Promise<void>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  const aborted = new Promise<boolean>((resolve) =>
    signal.addEventListener("abort", () => resolve(false), { once: true }),
  );

  return Promise.race([opened.then(() => true), aborted]);
}

function shellsDone(scope: Scope): readonly Promise<void>[] {
  return [...scope.shells.values()].map((shell) => shell.done);
}

/** An effect that runs before the host opens: its handler gets no host or plugin port. */
function local<K extends Effect["kind"]>(run: Handler<K, LocalHandlerContext>): Route<K> {
  return { kind: "local", run };
}

/** An effect that waits for the host to open. */
function host<K extends Effect["kind"]>(run: Handler<K, HandlerContext>): Route<K> {
  return { kind: "host", run };
}

const ROUTES: Routes = {
  follow: host((effect, context) =>
    effect.target === "new" ? openNew(context) : follow(effect.target, effect.announce, context),
  ),
  "load-earlier": host(loadEarlier),
  send: host((effect, context) => submit(effect.submission, effect.delivery, context)),
  revise: host(revise),
  withdraw: host(withdraw),
  "stop-run": host(stopRun),
  answer: host(answer),
  approve: host(approve),
  move: host(move),
  configure: host(configure),
  "shell-start": local(shellStart),
  "shell-stop": local(shellStop),
  composer: local(composer),
  scroll: local(scroll),
  load: host(load),
  "resolve-paste": local(resolvePaste),
  "read-clipboard": local(readClipboard),
  "read-dialog-clipboard": local(readDialogClipboard),
  copy: local(copy),
  "open-editor": local(openEditor),
  "open-external": local(openExternal),
  "write-settings": local(writeSettings),
  "change-directory": host(changeDirectory),
  reload: host(reload),
  compact: host(compact),
  "self-update": local(selfUpdate),
  login: host(login),
  logout: host(logout),
  "select-account": host(selectAccount),
  notify: local(notify),
  exit: local(exit),
  "refresh-workspace": local(refreshWorkspaceFacts),
  "run-command": host(runCommand),
  "stop-task": host(stopTask),
  "apply-setting": host(applySetting),
  "check-trust": host(checkTrust),
  "set-trust": host(setTrust),
  "login-answer": host(loginAnswer),
  "mcp-action": host(mcpAction),
  "mcp-login": host(mcpLogin),
  "list-directory": local(listDirectory),
  "resolve-mention": local(resolveMention),
  "read-preview": local(readPreview),
};
