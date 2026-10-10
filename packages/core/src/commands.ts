import type { CommandOutcome, Json, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Runs a core command in a session. Looks `name` up in the session's `commands` registry (`unknown` when absent, as for a client-side command), validates `args` against `arguments` when declared (`invalid` with the issues), and calls `run(args, { signal, api })` with the owning plugin's api and signal. A string answers `ran { output }`, nothing `ran { output: null }`; `{ prompt }` is sent to the session's main head as `LOCAL` with source `{ kind: "action", label: title, command: name }` and answers `sent { receipt }`; a throw answers `failed { message }`. What `kernel.command` runs. */
export function runCommand(
  kernel: Kernel,
  session: SessionId,
  name: string,
  args: Json | undefined,
): Promise<CommandOutcome> {
  throw new Error("not implemented");
}
