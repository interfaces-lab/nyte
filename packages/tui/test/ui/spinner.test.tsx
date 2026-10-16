import { expect, test } from "bun:test";
import { ManualClock } from "@opentui/core/testing";
import { createTickers } from "../../src/app/ticker.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../../src/lib/constants.ts";
import { Spinner } from "../../src/ui/chrome/spinner.tsx";
import { stateOf } from "../fixture/state.ts";
import { renderWithApp } from "./transcript/harness.tsx";

test("spinner frames advance with the clock and the interval stops on unmount", async () => {
  const app = await renderWithApp(stateOf(null), () => <Spinner />);

  expect(app.captureCharFrame()).toContain(SPINNER_FRAMES[0]);
  expect(app.clock.pendingTimerCount).toBe(1);

  app.clock.advance(SPINNER_INTERVAL_MS);
  await app.renderOnce();
  expect(app.captureCharFrame()).toContain(SPINNER_FRAMES[1]);
  expect(app.captureCharFrame()).not.toContain(SPINNER_FRAMES[0]);

  await app.dispose();
  expect(app.clock.pendingTimerCount).toBe(0);
});

test("one interval per period is shared and released by the last reader", () => {
  const clock = new ManualClock();
  const tickers = createTickers(clock);

  const first = tickers.ticker(SPINNER_INTERVAL_MS);
  const second = tickers.ticker(SPINNER_INTERVAL_MS);

  expect(clock.pendingTimerCount).toBe(1);
  expect(first).toBe(second);
  clock.advance(SPINNER_INTERVAL_MS);
  expect(first()).toBe(1);
  tickers.dispose();
  expect(clock.pendingTimerCount).toBe(0);
});
