import type { Revision } from "@nyte-ai/schema";
import type { OsProcess } from "./records.ts";
import type { StoreConnection } from "./store.ts";

export interface Member {
  readonly label: string;
  readonly pid: number | null;
  readonly capabilities: readonly string[];
  /** The machine this process runs on, which ends a job's process group after the host that started it is gone; absent where the host cannot tell its processes apart. */
  readonly machine?: Machine;
}

/** What a host can tell about the processes of the machine it runs on. It acts only on a process it identifies exactly, and answers `unknown` for one it cannot: on another boot, with a start it cannot read or read another way, or on a platform without process groups. */
export interface Machine {
  /** Ends the process group `process` leads: SIGTERM once its leader runs with the recorded start, then SIGKILL 2 s later unless the leader now runs with another start. Never signals pid 0 or 1, or this host's own process or group, and signals nothing while the leader is gone and its group still has members, which it cannot tell from another group. Answers `ended` once nothing in the group runs, `gone` when nothing of it ran to signal, and `unknown` when it cannot tell. */
  end(process: OsProcess): Promise<"ended" | "gone" | "unknown">;
}

export type Holder =
  | { readonly kind: "me" }
  | { readonly kind: "absent" }
  | { readonly kind: "alive"; readonly until: number }
  | { readonly kind: "dead"; readonly name: string; readonly expect: Revision };

export interface Presence {
  readonly instance: string;
  readonly member: Member;
  readonly store: StoreConnection;
  readonly revoked: AbortSignal;
  holder(instance: string): Promise<Holder>;
  sweep(): Promise<void>;
  close(leases?: readonly { readonly name: string; readonly expect: Revision }[]): Promise<void>;
}
