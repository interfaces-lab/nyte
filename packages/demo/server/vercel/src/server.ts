import { wakeSession } from "./dispatch.ts";
import { openRuntime } from "./runtime.ts";

let runtime: ReturnType<typeof openRuntime> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    runtime ??= openRuntime(wakeSession).catch((error: unknown) => {
      runtime = undefined;
      throw error;
    });
    return (await runtime).fetch(request);
  },
};
