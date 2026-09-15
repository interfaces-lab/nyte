/**
 * A no-op `BrowserAgent` for host tests that never exercise the browser.
 * Every method throws so an accidental call surfaces immediately.
 */
import type { BrowserAgent } from "./browser-agent.ts";

const fail = (): never => {
  throw new Error("Browser agent is not used in this test");
};

export function unusedBrowserAgent(): BrowserAgent {
  return {
    open: fail,
    snapshot: fail,
    click: fail,
    type: fail,
    press: fail,
    scroll: fail,
    wait: fail,
    console: fail,
    evaluate: fail,
    capture: fail,
    // release is called during plugin dispose; it must not throw.
    release() {},
    sessionSurfaceId: fail,
  };
}
