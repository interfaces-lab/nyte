import { wakeSession } from "./dispatch.ts";
import { openRuntime } from "./runtime.ts";

let runtime: ReturnType<typeof openRuntime> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    runtime ??= openRuntime(wakeSession).catch((cause: unknown) => {
      runtime = undefined;
      throw cause;
    });

    return (await runtime).fetch(request);
  },
};
