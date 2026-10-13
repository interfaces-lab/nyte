import type { DesktopHostDependencies } from "./host.ts";

/** The provider catalog the host opens with; absent, the host's own over this machine's credentials. The e2e build swaps this module for `fixtures/e2e-models.ts`. */
export const models: DesktopHostDependencies["models"] = undefined;
