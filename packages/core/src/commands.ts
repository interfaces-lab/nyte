import type { CommandOutcome, Json, SessionId } from "@nyte-ai/schema";
import { send } from "./admission.ts";
import { check } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { pluginSessionOf } from "./plugin-api.ts";
import { CORE_CONTEXT } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { MAIN } from "./session-state.ts";

/** Runs a core command in a session. Looks `name` up in the session's `commands` registry by its qualified `<owner>/<name>`, or by the bare name when exactly one command has it (§35d); `unknown` otherwise, as for a client-side command. Validates `args` against `arguments` when declared (`invalid` with the issues), and calls `run(args, { signal, api })` with the owning plugin's api and signal. A string answers `ran { output }`, nothing `ran { output: null }`; `{ prompt }` is sent to the session's main head as `CORE_CONTEXT` (`LOCAL`; as the caller's own context when that is a plugin api's of this session, which is `LOCAL` too, so a command run from the session's own activation sends without waiting on it, §37j) with source `{ kind: "action", label: title, command: <owner>/<name> }` and answers `sent { receipt }`; a throw, or a send that fails, answers `failed { message }`. What `kernel.command` runs. */
export async function runCommand(
  kernel: Kernel,
  session: SessionId,
  name: string,
  args: Json | undefined,
  context?: ConnectionContext,
): Promise<CommandOutcome> {
  const runtime = kernel.pluginsFor(session);
  const entries = runtime.registries.commands.entries();
  const qualified = entries.filter((entry) => `${entry.owner}/${entry.item.name}` === name);
  const bare = entries.filter((entry) => entry.item.name === name);
  const [found] = qualified.length === 1 ? qualified : bare.length === 1 ? bare : [];
  const api = found === undefined ? undefined : runtime.api(found.owner);

  if (found === undefined || api === undefined) return { kind: "unknown" };
  const { item: command, owner } = found;
  let input: unknown = args;

  if (command.arguments !== undefined) {
    const checked = await check(command.arguments, args);

    if (checked.kind === "invalid") return { kind: "invalid", issues: checked.issues };
    input = checked.value;
  }

  try {
    const result = await command.run(input, { signal: api.signal, api });

    if (typeof result === "string") return { kind: "ran", output: result };

    if (result === undefined) return { kind: "ran", output: null };

    const receipt = await send(kernel, {
      session,
      head: MAIN,
      context:
        context !== undefined && pluginSessionOf(context) === session ? context : CORE_CONTEXT,
      content: result.prompt,
      options: {
        source: { kind: "action", label: command.title, command: `${owner}/${command.name}` },
      },
    });

    return { kind: "sent", receipt: receipt.id };
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
