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
 * - `NYTE_TRACE_FILE`: the file each call appends its `mcp.serve` span to (`mcp-server.mjs`).
 */
import process from "node:process";
import { send, serve, sleep } from "./mcp-server.mjs";

const env = process.env;

const PLACES = [
  {
    id: "luigi",
    name: "Luigi's Trattoria",
    cuisine: "Italian",
    distanceKm: 0.4,
    url: "https://fixture.test/places/luigi",
  },
  {
    id: "saffron",
    name: "Saffron House",
    cuisine: "Indian",
    distanceKm: 0.7,
    url: "https://fixture.test/places/saffron",
  },
  {
    id: "noodle-88",
    name: "Noodle Bar 88",
    cuisine: "Ramen",
    distanceKm: 1.1,
    url: "https://fixture.test/places/noodle-88",
  },
  {
    id: "verde",
    name: "Verde",
    cuisine: "Vegetarian",
    distanceKm: 1.6,
    url: "https://fixture.test/places/verde",
  },
  {
    id: "harbor",
    name: "Harbor Fish Co.",
    cuisine: "Seafood",
    distanceKm: 2.3,
    url: "https://fixture.test/places/harbor",
  },
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
  "tools/call": call,
};

/** Answers one `tools/call` as the knobs say. */
async function call(params) {
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
}

serve("places", handlers);
