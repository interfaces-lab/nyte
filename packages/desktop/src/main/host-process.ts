import { app, dialog, MessageChannelMain, utilityProcess } from "electron";
import type { MessagePortMain, UtilityProcess } from "electron";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import type { CallReply, CallRequest } from "../shared/ipc.ts";
import type { AccountState } from "./account-session.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import type {
  HostAnswer,
  HostAsk,
  HostMessage,
  HostProcessOptions,
  MainAnswer,
  MainAsk,
  MainMessage,
} from "./host-messages.ts";
import { REVOKED_EXIT } from "./host-messages.ts";
import { Rpc } from "./host-rpc.ts";
import type { DesktopUpdateActivity } from "./host.ts";
import type { HostWindow } from "./host-window.ts";

interface HostProcessHandlers {
  event(event: HostEvent, window: HostWindow | undefined): void;
  awake(awake: boolean): void;
  settings(settings: DesktopSettings): void;
  answer(ask: HostAsk, signal: AbortSignal): Promise<MainAnswer>;
}

const STOPPED_MESSAGE = "The Nyte host stopped.";

const STOPPED: CallReply = {
  ok: false,
  error: { code: "unavailable", message: STOPPED_MESSAGE },
};

const STEADY_MS = 30_000;

const RESTART_DELAYS_MS = [250, 1_000, 4_000] as const;

interface Run {
  readonly child: UtilityProcess;
  readonly rpc: Rpc<MainAsk, HostAnswer, HostAsk, MainAnswer>;
  readonly exited: Promise<void>;
  alive: boolean;
}

export class HostProcess {
  readonly #entry: string;
  readonly #handlers: HostProcessHandlers;
  #options: HostProcessOptions;
  #current: Promise<Run | undefined>;
  #run: Run | undefined;
  #crashes = 0;
  #restart: ReturnType<typeof setTimeout> | undefined;
  #closing = false;

  constructor(entry: string, options: HostProcessOptions, handlers: HostProcessHandlers) {
    this.#entry = entry;
    this.#options = options;
    this.#handlers = handlers;
    this.#run = this.#fork();
    this.#current = Promise.resolve(this.#run);
  }

  async call(window: HostWindow, request: CallRequest): Promise<CallReply> {
    const run = await this.#current;

    if (run === undefined) return STOPPED;

    const answer = await run.rpc.ask({ kind: "call", window, request }).catch(() => undefined);

    if (answer?.kind !== "call") return STOPPED;

    const { reply } = answer;

    if (reply.ok && reply.path === "host.endpoint" && reply.value.credentials.kind === "token")
      this.#options = { ...this.#options, token: reply.value.credentials.token };

    return reply;
  }

  /** One end of a new channel whose other end the host serves; undefined while the host is stopped. A restarting host is waited for. */
  async openPort(): Promise<MessagePortMain | undefined> {
    const run = await this.#current;

    if (run === undefined || !run.alive) return undefined;
    const { port1, port2 } = new MessageChannelMain();
    run.child.postMessage({ kind: "port" } satisfies MainMessage, [port1]);

    return port2;
  }

  async activity(): Promise<DesktopUpdateActivity> {
    const run = await this.#current;

    if (run === undefined) return { kind: "idle" };

    try {
      const answer = await run.rpc.ask({ kind: "activity" });

      if (answer.kind !== "activity") throw new Error("The host answered another question.");

      return answer.activity;
    } catch (cause) {
      if (!run.alive) return { kind: "idle" };

      throw cause;
    }
  }

  seal(plain: string): Promise<string> {
    return this.#secret(true, plain);
  }

  open(sealed: string): Promise<string> {
    return this.#secret(false, sealed);
  }

  release(window: HostWindow): void {
    this.#post({ kind: "release", window });
  }

  resume(): void {
    this.#post({ kind: "resume" });
  }

  accountChanged(state: AccountState): void {
    this.#options = { ...this.#options, account: state };
    this.#post({ kind: "account", state });
  }

  async close(limitMs: number): Promise<void> {
    this.#closing = true;
    clearTimeout(this.#restart);
    this.#current = Promise.resolve(undefined);

    const run = this.#run;

    if (run === undefined) return;

    this.#post({ kind: "close" });

    const timer = setTimeout(() => run.child.kill(), limitMs);

    await run.exited;
    clearTimeout(timer);
  }

  #fork(): Run {
    const child = utilityProcess.fork(this.#entry, [], { serviceName: "Nyte Host" });
    const forkedAt = performance.now();
    const exit = Promise.withResolvers<void>();

    const run: Run = {
      child,
      rpc: new Rpc(
        (message) => {
          if (run.alive) child.postMessage(message);
        },
        (ask, signal) => this.#handlers.answer(ask, signal),
      ),
      exited: exit.promise,
      alive: true,
    };

    child.on("message", (message: HostMessage) => this.#receive(run, message));
    child.once("exit", (code) => {
      run.alive = false;
      run.rpc.close(STOPPED_MESSAGE);
      this.#exited(
        run,
        code === REVOKED_EXIT ? Number.POSITIVE_INFINITY : performance.now() - forkedAt,
      );
      exit.resolve();
    });
    child.postMessage({ kind: "open", options: this.#options });

    return run;
  }

  #exited(run: Run, uptimeMs: number): void {
    if (this.#run !== run) return;

    this.#run = undefined;
    this.#handlers.awake(false);

    if (this.#closing) return;

    this.#crashes = uptimeMs < STEADY_MS ? this.#crashes + 1 : 1;

    const delay = RESTART_DELAYS_MS[this.#crashes - 1];

    if (delay === undefined) {
      this.#current = Promise.resolve(undefined);
      void this.#offerRestart();

      return;
    }

    const restarted = Promise.withResolvers<Run | undefined>();

    this.#current = restarted.promise;
    this.#restart = setTimeout(() => {
      this.#restart = undefined;
      this.#run = this.#fork();
      restarted.resolve(this.#run);
    }, delay);
  }

  async #offerRestart(): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: "error",
      message: "Nyte Host keeps stopping",
      detail: `It stopped ${String(this.#crashes)} times right after starting, so chats can't send or run. Restart it, or quit and reopen Nyte.`,
      buttons: ["Restart Host", "Quit Nyte"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (this.#closing) return;

    if (response !== 0) {
      app.quit();

      return;
    }

    this.#crashes = 0;
    this.#run = this.#fork();
    this.#current = Promise.resolve(this.#run);
  }

  async #secret(seal: boolean, text: string): Promise<string> {
    const run = await this.#current;

    if (run === undefined) throw new Error(STOPPED_MESSAGE);

    const answer = await run.rpc.ask({ kind: "secret", seal, text });

    if (answer.kind !== "secret") throw new Error("The host answered another question.");

    return answer.text;
  }

  #post(message: MainMessage): void {
    if (this.#run?.alive === true) this.#run.child.postMessage(message);
  }

  #receive(run: Run, message: HostMessage): void {
    switch (message.kind) {
      case "event":
        this.#handlers.event(message.event, message.window);

        return;
      case "awake":
        this.#handlers.awake(message.awake);

        return;
      case "settings":
        this.#handlers.settings(message.settings);

        return;
      case "mark":
        performance.mark(message.name, { startTime: message.at - performance.timeOrigin });

        return;
      case "ask":
      case "abort":
      case "settle":
        run.rpc.receive(message);

        return;
      case "closed":
        return;
      default: {
        const _exhaustive: never = message;

        return _exhaustive;
      }
    }
  }
}
