import type { Revision } from "@nyte-ai/schema";
import type { OsProcess } from "./records.ts";
import type { StoreConnection } from "./store.ts";

export interface Member {
  readonly label: string;
  readonly pid: number | null;
  readonly capabilities: readonly string[];
  /** The machine this process runs on, which tells whether a peer on it is gone and ends a job's process group after the host that started it is gone; absent where the host cannot tell its processes apart. */
  readonly machine?: Machine;
}

/** What a host can tell about the processes of the machine it runs on. It acts only on a process it identifies exactly, and answers `unknown` for one it cannot: on another boot, with a start it cannot read or read another way, or on a platform without process groups. */
export interface Machine {
  /** This host's own process, recorded with its presence so a peer on this machine can tell when it is gone; null where it cannot tell. */
  self(): Promise<OsProcess | null>;
  /** `running` while `process`'s pid runs with its recorded start, `gone` once no process has its pid or the one that has it started at another time or has exited, and `unknown` when it cannot tell. Starts that agree to the platform's precision count as one process, so a pid taken again within that precision reads `running`. */
  state(process: OsProcess): Promise<"running" | "gone" | "unknown">;
  /** Ends the process group `process` leads: SIGTERM once its leader runs with the recorded start, then SIGKILL 2 s later unless the leader now runs with another start. Never signals pid 0 or 1, or this host's own process or group, and signals nothing while the leader is gone and its group still has members, which it cannot tell from another group. Answers `ended` once nothing in the group runs, `gone` when nothing of it ran to signal, and `unknown` when it cannot tell. */
  end(process: OsProcess): Promise<"ended" | "gone" | "unknown">;
}

export type Holder =
  | { readonly kind: "me" }
  | { readonly kind: "absent" }
  | { readonly kind: "alive"; readonly until: number }
  | {
      readonly kind: "dead";
      readonly name: string;
      readonly expect: Revision;
      /** `exited` when its machine says its OS process is gone; `lapsed` when it only stopped beating, as a paused process does too. */
      readonly why: "exited" | "lapsed";
    };

export interface Presence {
  readonly instance: string;
  readonly member: Member;
  readonly store: StoreConnection;
  readonly revoked: AbortSignal;
  holder(instance: string): Promise<Holder>;
  sweep(): Promise<void>;
  close(leases?: readonly { readonly name: string; readonly expect: Revision }[]): Promise<void>;
}
