import type { ClosingReason, Disposer } from "@nyte-ai/schema";
import { fault } from "@nyte-ai/core";
import type { ServerHost } from "@nyte-ai/core/server";
import type { Supervisor } from "./build-match.ts";

export type ClosingSocket = (reason: ClosingReason) => Promise<void>;

export interface Retirement {
  readonly supervisor: Supervisor | null;
  /** A client this host should make way for said hello: retire once no run or job is busy. */
  ask(): void;
  /** Tells every socket why the host is closing and closes each with 1001, once. */
  announce(reason: ClosingReason): Promise<void>;
  observe(socket: ClosingSocket): Disposer;
  close(): void;
}

const CHECK_MS = 10_000;

export function openRetirement(
  server: ServerHost,
  options: { readonly supervisor: Supervisor | null; readonly replaced: () => void },
): Retirement {
  const sockets = new Set<ClosingSocket>();
  let announced: { readonly reason: ClosingReason; readonly done: Promise<void> } | null = null;
  let asked = false;
  let checking: Promise<void> | null = null;
  let again = false;
  let stop: (() => void) | null = null;

  const announce = (reason: ClosingReason): Promise<void> => {
    announced ??= {
      reason,
      done: Promise.all([...sockets].map((socket) => socket(reason))).then(() => undefined),
    };

    return announced.done;
  };

  const check = (): void => {
    if (checking !== null) {
      again = true;

      return;
    }

    checking = server.retire().then(
      async (idle) => {
        checking = null;

        if (idle && stop !== null) {
          stop();
          stop = null;
          await announce("replacing");
          options.replaced();

          return;
        }

        if (again && stop !== null) {
          again = false;
          check();
        }
      },
      (error: unknown) => {
        checking = null;
        fault("host", "retire check failed", { error: String(error) });
      },
    );
  };

  return {
    supervisor: options.supervisor,
    ask() {
      if (asked || announced !== null) return;
      asked = true;
      const unobserve = server.onActivity(check);
      const timer = setInterval(check, CHECK_MS);
      timer.unref();

      stop = () => {
        unobserve();
        clearInterval(timer);
      };

      check();
    },
    announce,
    observe(socket) {
      sockets.add(socket);

      if (announced !== null) void socket(announced.reason);

      return () => {
        sockets.delete(socket);
      };
    },
    close() {
      stop?.();
      stop = null;
    },
  };
}
