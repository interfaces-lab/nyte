import type { HostProcess } from "@nyte-ai/app/contract/bridge.ts";
import type { HostActivity } from "@nyte-ai/schema";
import type { Live, LinkState } from "@nyte-ai/sdk/client";
import { dialog } from "electron";
import type { BrowserWindow, MessageBoxOptions } from "electron";
import { ExpectedHostError } from "../shared/errors.ts";
import { runningWork } from "../shared/update-activity.ts";
import type { HostAgent } from "./host-agent.ts";
import { readHostProcess } from "./host-status.ts";

const RESTART_LIMIT_MS = 30_000;

type ConfirmedAction = keyof typeof CONFIRMATIONS;

export interface HostProcessFollower {
  state(): HostProcess;
  restart(): Promise<void>;
  confirm(action: ConfirmedAction, window: BrowserWindow | undefined): Promise<void>;
  start(): Promise<void>;
}

export function followHostProcess(options: {
  readonly agent: HostAgent;
  readonly link: Live<LinkState>;
  activity(): Promise<HostActivity>;
  changed(state: HostProcess): void;
}): HostProcessFollower {
  let restarting = false;
  let shown = readHostProcess(options.link.snapshot());

  const state = (): HostProcess =>
    restarting ? { kind: "restarting" } : readHostProcess(options.link.snapshot());

  const publish = (): void => {
    const next = state();

    if (JSON.stringify(next) === JSON.stringify(shown)) return;
    shown = next;
    options.changed(next);
  };

  options.link.subscribe(publish);

  const restart = async (): Promise<void> => {
    if (restarting) return;
    const before = options.link.snapshot();
    restarting = true;
    publish();

    try {
      await options.agent.restart();
      await replaced(options.link, before.kind === "open" ? before.startedAt : null);
    } finally {
      restarting = false;
      publish();
    }
  };

  return {
    state,
    restart,
    async confirm(action, window) {
      if (!(await confirmed(action, await options.activity(), window))) return;

      if (action === "restart") return restart();
      await options.agent.stop();
    },
    async start() {
      await options.agent.start();
    },
  };
}

function replaced(link: Live<LinkState>, before: number | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      const state = link.snapshot();

      if (state.kind !== "open" || state.startedAt === before) return;
      clearTimeout(timer);
      stop();
      resolve();
    };

    const timer = setTimeout(() => {
      stop();
      reject(
        new ExpectedHostError({
          code: "timeout",
          message: "It didn't come back. Start it in Settings › Server.",
        }),
      );
    }, RESTART_LIMIT_MS);

    const stop = link.subscribe(check);
    check();
  });
}

const CONFIRMATIONS = {
  restart: {
    message: "Restart Nyte Host?",
    button: "Restart Host",
    busy: (running: string) => `Restarting stops ${running}.`,
    idle: "Chats and connected devices reconnect once the host is back.",
  },
  stop: {
    message: "Stop Nyte Host?",
    button: "Stop Host",
    busy: (running: string) =>
      `Stopping ends ${running}. The host starts again when you choose Start Host or reopen Nyte.`,
    idle: "Chats and connected devices stay offline until you choose Start Host or reopen Nyte.",
  },
} as const;

async function confirmed(
  action: ConfirmedAction,
  activity: HostActivity,
  window: BrowserWindow | undefined,
): Promise<boolean> {
  const copy = CONFIRMATIONS[action];
  const running = runningWork(activity);

  const options: MessageBoxOptions = {
    type: running === undefined ? "question" : "warning",
    message: copy.message,
    detail: running === undefined ? copy.idle : copy.busy(running),
    buttons: [copy.button, "Cancel"],
    defaultId: running === undefined ? 0 : 1,
    cancelId: 1,
    noLink: true,
  };

  const { response } =
    window === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);

  return response === 0;
}
