import type {
  CallInput,
  CallOutput,
  CallPath,
  CallReplyFor,
  CallRequest,
  CallTable,
} from "../shared/ipc.ts";
import { ExpectedHostError, ipcResult } from "./errors.ts";
import type { HostWindow } from "./host-window.ts";
import { decodeCallInput, decodeCallRequest } from "./ipc-inputs.ts";

/** Answers one decoded operation for a window. */
export type CallRoute = <P extends CallPath>(
  window: HostWindow,
  path: P,
  input: CallInput<P>,
) => Promise<CallOutput<P>>;

/** Runs `path` from `table`; a path this process does not answer is refused as unknown. */
export async function callTable<P extends CallPath>(
  table: CallTable,
  window: HostWindow,
  path: P,
  input: CallInput<P>,
): Promise<CallOutput<P>> {
  const handler = table[path];

  if (handler === undefined)
    throw new ExpectedHostError({ code: "unknown", message: "This operation isn't available." });

  return handler(window, input);
}

/** Decodes a renderer request and answers it through `route`. Main-frame authorization happens before this boundary. */
export function callIpc<R extends CallRequest>(
  route: CallRoute,
  window: HostWindow,
  request: R,
): Promise<R extends CallRequest ? CallReplyFor<R["path"]> : never>;
export async function callIpc(route: CallRoute, window: HostWindow, request: CallRequest) {
  const result = await ipcResult(async () => {
    const { path, input } = decodeCallRequest(request);

    return { path, value: await route(window, path, decodeCallInput(path, input)) };
  });

  return result.ok ? { ok: true as const, ...result.value } : result;
}
