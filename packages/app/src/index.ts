export { App } from "./app.tsx";

export type { UpdateState } from "./contract/bridge.ts";

export { connectLocalHost } from "./data/local-host.ts";
export { queryClient } from "./data/query-client.ts";
export { setUpdateStateForDemo } from "./data/host.ts";

export { createAppRouter, startWindowTabs, windowTabRoute } from "./shell/routes.tsx";

export type { DesktopWindow } from "./contract/desktop-window.ts";

export { startRendererStartup } from "./boot/startup.ts";

export { StartupFailure } from "./boot/startup-failure.tsx";

export { recordFirstFrame, seedFirstFrame, windowContentReady } from "./boot/first-frame.ts";
