import { testRender } from "@opentui/solid";
import { describe, expect, test } from "bun:test";
import { STORIES } from "../dev/stories/index.ts";
import { STORY_KEYBINDS } from "../dev/stories/story.tsx";
import { CHAT_KEYBINDS, FIELD_KEYBINDS } from "../src/lib/constants.ts";

function keys(bindings: Readonly<Record<string, string>>): readonly string[] {
  return Object.values(bindings).flatMap((binding) => binding.split(","));
}

test("story keys stay clear of the app's own keys", () => {
  const taken = new Set([...keys(CHAT_KEYBINDS), ...keys(FIELD_KEYBINDS)]);

  expect(keys(STORY_KEYBINDS).filter((key) => taken.has(key))).toEqual([]);
});

describe.each(STORIES.map((story) => [story.id, story] as const))("%s", (_id, story) => {
  test.each([40, 140])(
    "every key changes the frame and reset restores it at width %d",
    async (width) => {
      let exited: number | null = null;

      const setup = await testRender(() => <story.Root onExit={(code) => (exited = code)} />, {
        width,
        height: 30,
        kittyKeyboard: true,
      });

      const press = async (binding: string): Promise<string> => {
        setup.mockInput.pressKey(binding.toUpperCase());
        await setup.renderOnce();

        return setup.captureCharFrame();
      };

      await setup.renderOnce();
      const initial = setup.captureCharFrame();
      expect(initial).toContain(`story ${story.id}`);
      let before = initial;

      for (const [command, binding] of Object.entries(STORY_KEYBINDS)) {
        if (command === "story.reset") continue;
        const after = await press(binding);
        expect(after).not.toBe(before);
        before = after;
      }

      expect(await press(STORY_KEYBINDS["story.reset"])).toBe(initial);
      expect(exited).toBeNull();
      setup.renderer.destroy();
    },
  );
});
