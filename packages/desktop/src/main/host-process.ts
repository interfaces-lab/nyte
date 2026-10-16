import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import type { CallReply, CallRequest } from "../shared/ipc.ts";
import type { AccountState } from "./account-session.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import type {
  HostMessage,
  HostProcessOptions,
  HostRequest,
  MainAnswer,
  MainMessage,
} from "./host-messages.ts";
import type { DesktopUpdateActivity } from "./host.ts";
import type { HostWindow } from "./host-window.ts";

/** What main does with the host process's messages. */
export interface HostProcessHandlers {
  event(event: HostEvent, window: HostWindow | undefined): void;
  awake(awake: boolean): void;
  settings(settings: DesktopSettings): void;
  /** Answers a request for the browser panel or the account; `signal` aborts when the host gives up on it. */
  answer(request: HostRequest, signal: AbortSignal): Promise<MainAnswer>;
}

type Answered = Extract<HostMessage, { kind: "reply" | "activity" | "secret" }>;

const STOPPED: CallReply = {
  ok: false,
  error: { code: "unavailable", message: "The Nyte host stopped. Quit and reopen Nyte." },
};

/**
 * Main's handle on the host process (`host-entry.ts`): forks it at once, forwards host
 * operations and lifecycle to it, and turns its messages into window events, keep-awake and
 * settings. After the host process exits, every operation answers unavailable.
 */
export class HostProcess {
  readonly #child: UtilityProcess;
  readonly #handlers: HostProcessHandlers;
  readonly #waiting = new Map<number, (message: Answered | undefined) => void>();
  readonly #requests = new Map<number, AbortController>();
  readonly #exited: Promise<void>;
  #next = 0;
  #running = true;

  constructor(entry: string, options: HostProcessOptions, handlers: HostProcessHandlers) {
    this.#handlers = handlers;
    this.#child = utilityProcess.fork(entry, [], { serviceName: "Nyte Host" });
    this.#child.on("message", (message: HostMessage) => this.#receive(message));
    this.#exited = new Promise((resolve) => {
      this.#child.once("exit", () => {
        this.#running = false;

        for (const settle of this.#waiting.values()) settle(undefined);
        this.#waiting.clear();

        for (const request of this.#requests.values()) request.abort();
        this.#requests.clear();
        resolve();
      });
    });
    this.#post({ kind: "open", options });
  }

  /** Forwards one renderer request; the host process decodes and answers it. */
  call(window: HostWindow, request: CallRequest): Promise<CallReply> {
    return new Promise((resolve) => {
      const id = this.#wait((message) =>
        resolve(message?.kind === "reply" ? message.reply : STOPPED),
      );

      this.#post({ kind: "call", id, window, request });
    });
  }

  /** Running sessions and terminal commands, asked when called so a relaunch never trusts a stale count. */
  activity(): Promise<DesktopUpdateActivity> {
    return new Promise((resolve) => {
      const id = this.#wait((message) =>
        resolve(message?.kind === "activity" ? message.activity : { kind: "idle" }),
      );

      this.#post({ kind: "activity", id });
    });
  }

  /** Seals `plain` under the host's secrets key; the host reads the key only when asked. */
  seal(plain: string): Promise<string> {
    return this.#secret(true, plain);
  }

  /** Opens text `seal` sealed; rejects when another key sealed it or the key cannot be read. */
  open(sealed: string): Promise<string> {
    return this.#secret(false, sealed);
  }

  /** The window closed or left its document: its terminals end and its workspace is forgotten. */
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

  #secret(seal: boolean, text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = this.#wait((message) => {
        if (message?.kind !== "secret") reject(new Error("The Nyte host stopped."));
        else if (message.outcome.ok) resolve(message.outcome.text);
        else reject(new Error(message.outcome.message));
      });

      this.#post({ kind: "secret", id, seal, text });
    });
  }

  #wait(settle: (message: Answered | undefined) => void): number {
    const id = ++this.#next;

    if (this.#running) this.#waiting.set(id, settle);
    else settle(undefined);

    return id;
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
      case "reply":
      case "activity":
      case "secret":
        this.#waiting.get(message.id)?.(message);
        this.#waiting.delete(message.id);

        return;
      case "request":
        this.#answer(message.id, message.request);

        return;
      case "abort":
        this.#requests.get(message.id)?.abort();

        return;
      case "closed":
        return;
      default: {
        const _exhaustive: never = message;

        return _exhaustive;
      }
    }
  }

  #answer(id: number, request: HostRequest): void {
    const controller = new AbortController();
    this.#requests.set(id, controller);

    void this.#handlers
      .answer(request, controller.signal)
      .then(
        (answer) => this.#post({ kind: "answer", id, outcome: { ok: true, answer } }),
        (cause: unknown) =>
          this.#post({
            kind: "answer",
            id,
            outcome: { ok: false, message: cause instanceof Error ? cause.message : String(cause) },
          }),
      )
      .finally(() => this.#requests.delete(id));
  }
}
