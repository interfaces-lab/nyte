export { App } from "./app.tsx";

export type { UpdateState } from "./bridge.ts";

export { connectLocalHost, queryClient, setUpdateStateForDemo } from "./queries.ts";

export { createAppRouter, startWindowTabs, windowTabRoute } from "./router.tsx";

export { startRendererStartup } from "./startup.ts";

export { StartupFailure } from "./startup-failure.tsx";

export { recordFirstFrame, seedFirstFrame, windowContentReady } from "./first-frame.ts";
