import { Profiler } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Countdown } from "./countdown.tsx";

const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));

export async function run() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let renders = 0;
  try {
    flushSync(() =>
      root.render(
        <Profiler id="countdown" onRender={() => (renders += 1)}>
          <Countdown until={Date.now() + 40} />
        </Profiler>,
      ),
    );
    await wait(100);
    if (container.textContent !== "· 0:00") throw new Error("Countdown did not reach zero");
    const finalRenders = renders;
    await wait(100);
    if (renders !== finalRenders) throw new Error("Countdown kept ticking after zero");
    return "passed";
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
