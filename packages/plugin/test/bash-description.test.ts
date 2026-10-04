/**
 * The bash description from a client's seat: the model is offered the
 * parameter, and what it writes there heads the call in the transcript.
 */
import assert from "node:assert/strict";
import { afterEach, expect, test } from "vitest";
import type { StreamFn } from "@nyte-ai/core";
import { toolsFsPlugin } from "@nyte-ai/plugin";
import { getCurrentTools } from "@nyte-ai/schema";
import type { Tool } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { bashDescriptionPlugin } from "../examples/bash-description.ts";
import { respond, testModel, toolCall, toolParts, TestWorkspace } from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
});

const parameters = Type.Object({
  properties: Type.Record(Type.String(), Type.Unknown()),
  required: Type.Array(Type.String()),
});

async function ranWith(description: string) {
  const world = TestWorkspace.create("nyte-bash-description-");
  workspaces.push(world);
  const offered: Tool[] = [];
  const model: StreamFn = (current, context) => {
    offered.push(...getCurrentTools(context.messages));
    if (context.messages.some((message) => message.role === "toolResult"))
      return respond(current, [{ type: "text", text: "done" }]);
    return respond(current, [toolCall("bash-1", "bash", { command: "echo hi", description })]);
  };
  const sdk = await world.open({
    streamFn: model,
    plugins: [toolsFsPlugin(), bashDescriptionPlugin],
    model: testModel,
  });
  const { sessionId } = world;
  await sdk.messages.send({ sessionId, content: [{ type: "text", text: "say hi" }] });
  await expect
    .poll(async () => (await sdk.runs.wait({ sessionId })).kind, { timeout: 5_000 })
    .toBe("idle");
  const [part] = await toolParts(sdk, sessionId);
  assert.ok(part);
  return { offered, part };
}

test("the model is offered a description and a trimmed one heads the call; bash's own facts stay", async () => {
  const { offered, part } = await ranWith("  Print a greeting  ");
  const bash = offered.find((tool) => tool.name === "bash");
  assert.ok(bash && Value.Check(parameters, bash.parameters));
  assert.ok("description" in bash.parameters.properties);
  assert.ok(!bash.parameters.required.includes("description"));
  assert.ok(part.class.kind === "shell");
  assert.equal(part.class.command, "echo hi");
  assert.equal(part.class.description, "Print a greeting");
  assert.equal(part.class.facts?.truncated, false);
  assert.equal(part.output?.trim(), "hi");
});

test("a blank description is left out of the call", async () => {
  const { part } = await ranWith("   ");
  assert.ok(part.class.kind === "shell");
  assert.equal(part.class.command, "echo hi");
  assert.ok(!("description" in part.class));
});
