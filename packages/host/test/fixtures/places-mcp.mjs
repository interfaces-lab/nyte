#!/usr/bin/env node
/**
 * A deterministic stdio MCP server with one tool, `search_places`. Its
 * environment picks the perturbation:
 *
 * - `PLACES_COLD_MS`: delays the `initialize` answer.
 * - `PLACES_DELAY_MS`: delays each `tools/call`.
 * - `PLACES_PROGRESS=1`: sends three progress notifications per call.
 * - `PLACES_CRASH=call|list`: exits at that request.
 * - `PLACES_INVALID_SCHEMA=1`: advertises an input schema that is not JSON Schema.
 * - `PLACES_ERROR=1`: answers each call with `isError`.
 * - `PLACES_LOG_BYTES`: answers with a log of about that many bytes whose last line is the failure.
 * - `PLACES_INSTRUCTIONS`: the server instructions `initialize` answers with.
 */
import { createInterface } from "node:readline";
import process from "node:process";

const env = process.env;

const PLACES = [
  { id: "luigi", name: "Luigi's Trattoria", cuisine: "Italian", distanceKm: 0.4 },
  { id: "saffron", name: "Saffron House", cuisine: "Indian", distanceKm: 0.7 },
  { id: "noodle-88", name: "Noodle Bar 88", cuisine: "Ramen", distanceKm: 1.1 },
  { id: "verde", name: "Verde", cuisine: "Vegetarian", distanceKm: 1.6 },
  { id: "harbor", name: "Harbor Fish Co.", cuisine: "Seafood", distanceKm: 2.3 },
];

const SCHEMA =
  env.PLACES_INVALID_SCHEMA === "1"
    ? { type: "object", properties: { near: { type: "strng" } }, required: "near" }
    : {
        type: "object",
        properties: {
          near: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["near"],
        additionalProperties: false,
      };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const log = (bytes) => {
  const line = "ok   step passed in 3ms\n";
  const failure = "FAILED test/places.test.ts > finds the nearest place: expected 0.4 to be 0.7\n";

  return line.repeat(Math.max(0, Math.ceil((bytes - failure.length) / line.length))) + failure;
};

const handlers = {
  async initialize() {
    await sleep(env.PLACES_COLD_MS);

    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "places-fixture", version: "1.0.0" },
      instructions: env.PLACES_INSTRUCTIONS,
    };
  },
  async "tools/list"() {
    if (env.PLACES_CRASH === "list") process.exit(1);

    return {
      tools: [
        {
          name: "search_places",
          title: "Search places",
          description: "Find places near a location.\nDeterministic fixture data.",
          inputSchema: SCHEMA,
          annotations: { readOnlyHint: true },
        },
      ],
    };
  },
  async "tools/call"(params) {
    if (env.PLACES_CRASH === "call") process.exit(1);
    const token = params?._meta?.progressToken;

    if (env.PLACES_PROGRESS === "1" && token !== undefined)
      for (let step = 1; step <= 3; step += 1) {
        send({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: token, progress: step, total: 3, message: `Page ${step}` },
        });
        await sleep(Number(env.PLACES_DELAY_MS ?? 0) / 3);
      }
    else await sleep(env.PLACES_DELAY_MS);

    if (env.PLACES_ERROR === "1")
      return { isError: true, content: [{ type: "text", text: "Upstream places API is down." }] };

    if (env.PLACES_LOG_BYTES !== undefined)
      return { content: [{ type: "text", text: log(Number(env.PLACES_LOG_BYTES)) }] };
    const places = PLACES.slice(0, Math.min(5, params?.arguments?.limit ?? 5));

    return {
      content: [{ type: "text", text: JSON.stringify({ near: params?.arguments?.near, places }) }],
    };
  },
};

createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);

  if (message.id === undefined) return;
  const handler = handlers[message.method];

  if (handler === undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` },
    });

    return;
  }

  send({ jsonrpc: "2.0", id: message.id, result: await handler(message.params) });
});
