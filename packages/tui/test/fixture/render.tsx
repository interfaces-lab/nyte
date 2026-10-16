import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import type { JSX } from "@opentui/solid";

export const SIZE = { width: 100, height: 32 } as const;

export async function render(
  node: () => JSX.Element,
  options?: TestRendererOptions,
): Promise<TestRendererSetup> {
  const setup = await testRender(node, { ...SIZE, kittyKeyboard: true, ...options });
  await setup.renderOnce();

  return setup;
}

export async function frameShowing(
  setup: Pick<TestRendererSetup, "renderOnce" | "captureCharFrame">,
  text: string,
  timeout = 3_000,
): Promise<string> {
  const deadline = Date.now() + timeout;

  for (;;) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();

    if (frame.includes(text) || Date.now() > deadline) return frame;
    await Bun.sleep(5);
  }
}
