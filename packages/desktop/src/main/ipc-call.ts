import type { CallReplyFor, CallRequest } from "../shared/ipc.ts";
import { ipcResult } from "./errors.ts";
import type { DesktopHost, HostWindow } from "./host.ts";
import { decodeCallRequest } from "./ipc-inputs.ts";

/** Main-frame authorization happens before this request boundary. */
export function callIpc<R extends CallRequest>(
  getHost: () => DesktopHost,
  window: HostWindow,
  request: R,
): Promise<CallReplyFor<R["path"]>>;
export async function callIpc(
  getHost: () => DesktopHost,
  window: HostWindow,
  request: CallRequest,
) {
  const result = await ipcResult(async () => {
    const decoded = decodeCallRequest(request);

    return { path: decoded.path, value: await getHost().call(window, decoded.path, decoded.input) };
  });

  return result.ok ? { ok: true as const, ...result.value } : result;
}
