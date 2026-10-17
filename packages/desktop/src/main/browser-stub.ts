/**
 * A no-op `BrowserAgent` for host tests that never exercise the browser.
 * Every method throws so an accidental call surfaces immediately.
 */
import type { BrowserAgent } from "./browser-agent.ts";

const fail = (): never => {
  throw new Error("Browser agent is not used in this test");
};

/** Every method fails except `release`, which plugin dispose calls and so must not throw. */
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
    release() {},
    sessionSurfaceId: fail,
  };
}
