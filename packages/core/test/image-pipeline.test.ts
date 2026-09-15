/**
 * Every image that enters history is bounded once, wherever it came from: a
 * tool result from a plugin or MCP bridge, or an attachment a client uploaded.
 * An oversized image makes the provider reject the whole conversation, not
 * only the turn that carried it.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { PhotonImage } from "@cf-wasm/photon/node";
import { Type } from "typebox";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import { bindTool } from "../src/tools/bind-tool.ts";
import type { AgentTool } from "../src/types.ts";
import { DEFAULT_IMAGE_LIMITS, processImage } from "../src/utils/image.ts";
import type { StreamFn } from "../src/types.ts";
import { assistant, openStore, sleep, within } from "./kernel/helpers.ts";

function oversizedPng(): Buffer {
  const image = new PhotonImage(new Uint8Array(4 * 2400 * 1200).fill(255), 2400, 1200);
  try {
    return Buffer.from(image.get_bytes());
  } finally {
    image.free();
  }
}

function dimensions(base64: string): { readonly width: number; readonly height: number } {
  const decoded = PhotonImage.new_from_byteslice(Buffer.from(base64, "base64"));
  try {
    return { width: decoded.get_width(), height: decoded.get_height() };
  } finally {
    decoded.free();
  }
}

test("processImage bounds dimensions and reports the coordinate scale", async () => {
  const processed = await processImage(oversizedPng(), "image/png");
  assert.ok(processed.ok);
  assert.deepEqual(dimensions(processed.data), { width: 2000, height: 1000 });
  assert.ok(processed.data.length <= DEFAULT_IMAGE_LIMITS.maxBase64Bytes);
  assert.ok(
    processed.hints.some((hint) => hint.includes("Multiply coordinates by 1.20")),
    processed.hints.join("\n"),
  );
});

test("a tool's own image is bounded before it reaches the model", async () => {
  const parameters = Type.Object({});
  const tool: AgentTool<typeof parameters, undefined> = {
    name: "screenshot",
    description: "Returns an image",
    parameters,
    execute: async () => ({
      content: [
        { type: "text", text: "shot" },
        { type: "image", data: oversizedPng().toString("base64"), mimeType: "image/png" },
      ],
      details: undefined,
    }),
  };

  const result = await bindTool(tool).execute("call", {}, undefined, () => undefined, undefined);
  const image = result.content.find((part) => part.type === "image");
  assert.ok(image);
  assert.deepEqual(dimensions(image.data), { width: 2000, height: 1000 });
  const hint = result.content.find(
    (part) => part.type === "text" && part.text.includes("original"),
  );
  assert.ok(hint, "the model is told how to map coordinates back");
});

test("an undecodable tool image is passed through rather than dropped", async () => {
  const parameters = Type.Object({});
  const data = Buffer.from("not an image").toString("base64");
  const tool: AgentTool<typeof parameters, undefined> = {
    name: "broken",
    description: "Returns junk",
    parameters,
    execute: async () => ({
      content: [{ type: "image", data, mimeType: "image/png" }],
      details: undefined,
    }),
  };

  const result = await bindTool(tool).execute("call", {}, undefined, () => undefined, undefined);
  assert.deepEqual(result.content, [{ type: "image", data, mimeType: "image/png" }]);
});

const model: Model<Api> = {
  id: "test-model",
  name: "Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

test("an uploaded image is bounded before the message lands", async () => {
  const streamFn: StreamFn = () => {
    const answer = assistant("ok");
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...answer, content: [] } });
    stream.push({ type: "done", reason: "stop", message: answer });
    return stream;
  };
  const nyte = await createNyte({
    store: openStore(),
    streamFn,
    models: {
      getModels: () => [model],
      getModel: () => model,
      getAvailable: async () => [model],
    },
    model,
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
  });
  try {
    const { sessionId } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({
      sessionId,
      content: [
        { type: "text", text: "what is this" },
        { type: "image", data: oversizedPng().toString("base64"), mimeType: "image/png" },
      ],
    });
    await within(
      (async () => {
        for (;;) {
          const outcome = await nyte.runs.wait({ sessionId });
          if (outcome.kind === "idle") return;
          await sleep(10);
        }
      })(),
      10_000,
    );

    const turns = await nyte.messages.list({ sessionId });
    const parts = turns.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
    const user = parts.find((part) => part.kind === "user");
    assert.ok(user);
    assert.ok(typeof user.content !== "string");
    const image = user.content.find((block) => block.type === "image");
    assert.ok(image);
    assert.deepEqual(dimensions(image.data), { width: 2000, height: 1000 });
  } finally {
    await nyte.close();
  }
});
