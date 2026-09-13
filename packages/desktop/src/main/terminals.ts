import { basename } from "node:path";
import { userInfo } from "node:os";
import { spawn } from "@lydell/node-pty";
import type { IPty } from "@lydell/node-pty";
import type { HostEvent, TerminalInfo } from "../shared/ipc.ts";

const HIGH_WATER = 128 * 1024;
const LOW_WATER = 32 * 1024;

interface TerminalProcess {
  readonly process: IPty;
  readonly subscriptions: readonly { dispose(): void }[];
  pending: number;
  paused: boolean;
}

/** Window-owned shells. A hidden renderer panel is not a closed terminal. */
export class TerminalSessions {
  private readonly processes = new Map<string, TerminalProcess>();

  private readonly emit: (event: HostEvent) => void;
  private readonly shell: string;

  constructor(
    emit: (event: HostEvent) => void,
    shell = process.platform === "win32"
      ? (process.env["COMSPEC"] ?? "cmd.exe")
      : userInfo().shell || process.env["SHELL"] || "/bin/sh",
  ) {
    this.emit = emit;
    this.shell = shell;
  }

  create(input: { readonly id: string; readonly cwd: string }): TerminalInfo {
    if (this.processes.has(input.id)) throw new Error("Terminal already exists");
    if (this.processes.size >= 32) throw new Error("Close a terminal before opening another");
    const shell = this.shell;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "Nyte",
      SHELL: shell,
    };
    delete env["ELECTRON_RUN_AS_NODE"];
    delete env["NODE_OPTIONS"];
    const pty = spawn(shell, process.platform === "win32" ? [] : ["-i", "-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: input.cwd,
      env,
    });
    const output = pty.onData((data) => {
      const entry = this.processes.get(input.id);
      if (entry === undefined) return;
      entry.pending += data.length;
      if (!entry.paused && entry.pending >= HIGH_WATER) {
        entry.paused = true;
        pty.pause();
      }
      this.emit({ kind: "terminal_data", id: input.id, data });
    });
    const exit = pty.onExit(({ exitCode }) => {
      const entry = this.processes.get(input.id);
      if (entry === undefined) return;
      this.processes.delete(input.id);
      for (const subscription of entry.subscriptions) subscription.dispose();
      this.emit({ kind: "terminal_exit", id: input.id, exitCode });
    });
    this.processes.set(input.id, {
      process: pty,
      subscriptions: [output, exit],
      pending: 0,
      paused: false,
    });
    return { id: input.id, title: basename(shell), cwd: input.cwd };
  }

  write(input: { readonly id: string; readonly data: string }): void {
    const entry = this.processes.get(input.id);
    if (entry === undefined) throw new Error("This terminal has exited");
    entry.process.write(input.data);
  }

  resize(input: { readonly id: string; readonly cols: number; readonly rows: number }): void {
    this.processes.get(input.id)?.process.resize(input.cols, input.rows);
  }

  /**
   * The pty names the foreground process group leader, so an idle prompt reports the
   * shell itself. Windows reports the spawned file instead, so it never claims idle.
   */
  idle(input: { readonly id: string }): boolean {
    const entry = this.processes.get(input.id);
    return entry === undefined || this.processIsIdle(entry);
  }

  busyCount(): number {
    let count = 0;
    for (const entry of this.processes.values()) {
      if (!this.processIsIdle(entry)) count++;
    }
    return count;
  }

  acknowledge(input: { readonly id: string; readonly length: number }): void {
    const entry = this.processes.get(input.id);
    if (entry === undefined) return;
    entry.pending = Math.max(0, entry.pending - input.length);
    if (entry.paused && entry.pending <= LOW_WATER) {
      entry.paused = false;
      entry.process.resume();
    }
  }

  close(input: { readonly id: string }): void {
    const entry = this.processes.get(input.id);
    if (entry === undefined) return;
    this.processes.delete(input.id);
    for (const subscription of entry.subscriptions) subscription.dispose();
    entry.process.kill();
  }

  dispose(): void {
    for (const id of this.processes.keys()) this.close({ id });
  }

  private processIsIdle(entry: TerminalProcess): boolean {
    if (process.platform === "win32") return false;
    return basename(entry.process.process) === basename(this.shell);
  }
}
