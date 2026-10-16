import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
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
import { Rpc } from "./host-rpc.ts";
import type { DesktopUpdateActivity } from "./host.ts";
import type { HostWindow } from "./host-window.ts";

/** What main does with the host process's messages. */
interface HostProcessHandlers {
  event(event: HostEvent, window: HostWindow | undefined): void;
  awake(awake: boolean): void;
  settings(settings: DesktopSettings): void;
  /** Answers a request for the browser panel or the account; `signal` aborts when the host gives up on it. */
  answer(ask: HostAsk, signal: AbortSignal): Promise<MainAnswer>;
}

const STOPPED_MESSAGE = "The Nyte host stopped.";

const STOPPED: CallReply = {
  ok: false,
  error: { code: "unavailable", message: `${STOPPED_MESSAGE} Quit and reopen Nyte.` },
};

/**
 * Main's handle on the host process (`host-entry.ts`): forks it at once, forwards host
 * operations and lifecycle to it, and turns its messages into window events, keep-awake and
 * settings. After the host process exits, every operation answers unavailable.
 */
export class HostProcess {
  readonly #child: UtilityProcess;
  readonly #handlers: HostProcessHandlers;
  readonly #rpc: Rpc<MainAsk, HostAnswer, HostAsk, MainAnswer>;
  readonly #exited: Promise<void>;
  #running = true;

  constructor(entry: string, options: HostProcessOptions, handlers: HostProcessHandlers) {
    this.#handlers = handlers;
    this.#rpc = new Rpc(
      (message) => this.#post(message),
      (ask, signal) => handlers.answer(ask, signal),
    );
    this.#child = utilityProcess.fork(entry, [], { serviceName: "Nyte Host" });
    this.#child.on("message", (message: HostMessage) => this.#receive(message));
    this.#exited = new Promise((resolve) => {
      this.#child.once("exit", () => {
        this.#running = false;
        this.#rpc.close(STOPPED_MESSAGE);
        resolve();
      });
    });
    this.#post({ kind: "open", options });
  }

  /** Forwards one renderer request; the host process decodes and answers it. */
  async call(window: HostWindow, request: CallRequest): Promise<CallReply> {
    const answer = await this.#rpc.ask({ kind: "call", window, request }).catch(() => undefined);

    return answer?.kind === "call" ? answer.reply : STOPPED;
  }

  /** Running sessions and terminal commands, asked when called so a relaunch never trusts a stale count; a stopped host runs nothing. */
  async activity(): Promise<DesktopUpdateActivity> {
    try {
      const answer = await this.#rpc.ask({ kind: "activity" });

      if (answer.kind !== "activity") throw new Error("The host answered another question.");

      return answer.activity;
    } catch (cause) {
      if (!this.#running) return { kind: "idle" };

      throw cause;
    }
  }

  /** Seals `plain` under the host's secrets key; the host reads the key only when asked. */
  seal(plain: string): Promise<string> {
    return this.#secret(true, plain);
  }

  /** Opens text `seal` sealed; rejects when another key sealed it or the key cannot be read. */
  open(sealed: string): Promise<string> {
    return this.#secret(false, sealed);
  }

  /** The window closed or left its document: its workspace is forgotten. */
  release(window: HostWindow): void {
    this.#post({ kind: "release", window });
  }

  /** The Mac woke: leases held before sleep say nothing about now. */
  resume(): void {
    this.#post({ kind: "resume" });
  }

  accountChanged(state: AccountState): void {
    this.#post({ kind: "account", state });
  }

  /** Closes the host and waits for its process to exit, killing it after `limitMs`. */
  async close(limitMs: number): Promise<void> {
    this.#post({ kind: "close" });

    const timer = setTimeout(() => this.#child.kill(), limitMs);

    await this.#exited;
    clearTimeout(timer);
  }

  async #secret(seal: boolean, text: string): Promise<string> {
    const answer = await this.#rpc.ask({ kind: "secret", seal, text });

    if (answer.kind !== "secret") throw new Error("The host answered another question.");

    return answer.text;
  }

  #post(message: MainMessage): void {
    if (this.#running) this.#child.postMessage(message);
  }

  #receive(message: HostMessage): void {
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
        this.#rpc.receive(message);

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
