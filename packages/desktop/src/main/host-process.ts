import { setTimeout as sleep } from "node:timers/promises";
import type { HostProcess } from "@nyte-ai/app/contract/bridge.ts";
import { serial } from "@nyte-ai/schema/serial";
import { dialog } from "electron";
import type { BrowserWindow, MessageBoxOptions } from "electron";
import { runningWork } from "../shared/update-activity.ts";
import type { DesktopUpdateActivity } from "../shared/update-activity.ts";
import { processStarted } from "./host-agent.ts";
import type { HostAgent } from "./host-agent.ts";
import type { HostLinkState } from "./host-link.ts";
import { readHostUpdate } from "./host-status.ts";

/** How long a restart reads as restarting before the link's own state shows again. */
const RESTART_LIMIT_MS = 30_000;

const RESTART_POLL_MS = 250;

type ConfirmedAction = keyof typeof CONFIRMATIONS;

export interface HostProcessFollower {
  state(): HostProcess;
  linkChanged(): void;
  restart(): Promise<void>;
  /** Asks in a dialog that names the running work, then restarts or stops the host. */
  confirm(action: ConfirmedAction, window: BrowserWindow | undefined): Promise<void>;
  start(): Promise<void>;
}

export function followHostProcess(options: {
  readonly agent: HostAgent;
  readonly appVersion: string;
  link(): HostLinkState;
  activity(): Promise<DesktopUpdateActivity>;
  changed(state: HostProcess): void;
}): HostProcessFollower {
  const reads = serial();
  let state: HostProcess = { kind: "offline" };
  let restarting = false;
  let restarted = false;

  const set = (next: HostProcess): void => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    options.changed(next);
  };

  const read = (): Promise<void> =>
    reads.run(async () => {
      if (restarting) return;
      const link = options.link();
      const serving = link.kind === "connected" ? await options.agent.serving() : null;
      const startedAt = serving === null ? null : await processStarted(serving.pid);

      const update = readHostUpdate({
        link,
        appVersion: options.appVersion,
        own: serving?.own ?? false,
        restarted,
      });

      if (restarting || link !== options.link()) return;

      if (update === "offline" || link.kind !== "connected") {
        set({ kind: "offline" });

        return;
      }

      if (update === "restart") {
        void restart().catch(() => undefined);

        return;
      }

      set({ kind: update, version: link.version, startedAt });
    });

  const restart = async (): Promise<void> => {
    if (restarting) return;
    restarting = true;
    restarted = true;
    set({ kind: "restarting" });

    try {
      const before = await options.agent.serving();
      await options.agent.restart();
      await replaced(options, before?.pid);
    } finally {
      restarting = false;
      await read();
    }
  };

  return {
    state: () => state,
    linkChanged: () => void read(),
    restart,
    async confirm(action, window) {
      if (!(await confirmed(action, await options.activity(), window))) return;

      if (action === "restart") return restart();
      await options.agent.stop();
      await read();
    },
    async start() {
      await options.agent.start();
    },
  };
}

async function replaced(
  options: { readonly agent: HostAgent; link(): HostLinkState },
  before: number | undefined,
): Promise<void> {
  const deadline = Date.now() + RESTART_LIMIT_MS;

  while (Date.now() < deadline) {
    const serving = await options.agent.serving();

    if (serving !== null && serving.pid !== before && options.link().kind === "connected") return;
    await sleep(RESTART_POLL_MS);
  }
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
  activity: DesktopUpdateActivity,
  window: BrowserWindow | undefined,
): Promise<boolean> {
  const copy = CONFIRMATIONS[action];

  const options: MessageBoxOptions = {
    type: activity.kind === "busy" ? "warning" : "question",
    message: copy.message,
    detail: activity.kind === "busy" ? copy.busy(runningWork(activity)) : copy.idle,
    buttons: [copy.button, "Cancel"],
    defaultId: activity.kind === "busy" ? 1 : 0,
    cancelId: 1,
    noLink: true,
  };

  const { response } =
    window === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);

  return response === 0;
}
