import type { CallReplyFor, CallRequest } from "../shared/ipc.ts";
import { ipcResult } from "./errors.ts";
import type { DesktopHost } from "./host.ts";
import { decodeCallRequest } from "./ipc-inputs.ts";

/** Main-frame authorization happens before this request boundary. */
export function callIpc<R extends CallRequest>(
  getHost: () => DesktopHost,
  request: R,
): Promise<CallReplyFor<R["path"]>>;
export async function callIpc(getHost: () => DesktopHost, request: CallRequest) {
  const result = await ipcResult(async () => {
    const decoded = decodeCallRequest(request);
    return { path: decoded.path, value: await getHost().call(decoded.path, decoded.input) };
  });
  return result.ok ? { ok: true as const, ...result.value } : result;
}
