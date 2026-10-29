export { App } from "./app.tsx";

export type { UpdateState } from "./contract/bridge.ts";

export { connectLocalHost, queryClient, setUpdateStateForDemo } from "./queries.ts";

export { createAppRouter, startWindowTabs, windowTabRoute } from "./shell/routes.tsx";

export type { DesktopWindow } from "./contract/desktop-window.ts";

export { startRendererStartup } from "./startup.ts";

export { StartupFailure } from "./startup-failure.tsx";

export { recordFirstFrame, seedFirstFrame, windowContentReady } from "./first-frame.ts";
