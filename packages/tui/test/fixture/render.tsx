/**
 * `testRender` at the QA terminal's size (100×32) with the kitty keyboard
 * protocol on, one frame already drawn. Dispose with `await using`:
 *
 *   await using app = await render(() => <Hints />);
 *   expect(app.captureCharFrame()).toContain("enter send");
 */
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
