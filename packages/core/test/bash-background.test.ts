import { expect, test } from "vitest";
import { createBashTool } from "../src/tools/bash.ts";

const tool = createBashTool(process.cwd());

test("the background flag is parsed at the boundary and the bare tool still waits for output", async () => {
  for (const background of [true, false])
    expect(tool.prepareArguments?.({ command: "printf done", background })).toEqual({
      command: "printf done",
      background,
    });
  expect(tool.prepareArguments?.({ command: "printf done" })).toEqual({
    command: "printf done",
  });
  expect(() => tool.prepareArguments?.({ command: "printf done", background: "true" })).toThrow(
    /background must be boolean/,
  );
  const result = await tool.execute("bash-background", {
    command: "printf done",
    background: true,
  });
  expect(result.content).toEqual([{ type: "text", text: "done" }]);
});
