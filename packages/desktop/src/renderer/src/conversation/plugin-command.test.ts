import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { CommandInfo } from "@nyte-ai/core";
import { parsePluginCommand } from "./plugin-command.ts";

const commands = [
  { name: "rename", owner: "rename", description: "Name the chat" },
  { name: "review", owner: "reviewer", description: "Review a change" },
] satisfies readonly CommandInfo[];

describe("plugin command drafts", () => {
  test("parses an active command and preserves its argument text", () => {
    assert.deepEqual(parsePluginCommand("  /rename   API   cleanup  ", commands), {
      name: "rename",
      argument: "API   cleanup",
    });
    assert.deepEqual(parsePluginCommand("/rename", commands), {
      name: "rename",
      argument: "",
    });
  });

  test("leaves unknown and embedded slash text as ordinary messages", () => {
    assert.equal(parsePluginCommand("/missing hello", commands), undefined);
    assert.equal(parsePluginCommand("please /rename this", commands), undefined);
    assert.equal(parsePluginCommand("/Rename this", commands), undefined);
  });
});
