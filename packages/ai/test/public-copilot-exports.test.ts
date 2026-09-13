import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { test } from "vitest";
import {
  DEVICE,
  EXCHANGE,
  MODELS,
  ORIGIN,
  SESSION_TOKEN,
  TOKEN,
  deviceCode,
  fakeFetch,
  json,
  sessionToken,
} from "./github-copilot-fixture.ts";

const CompletionSchema = Type.Object({
  type: Type.Literal("complete"),
  apiKey: Type.String(),
  origin: Type.String(),
  models: Type.Array(Type.String()),
});

test("public Copilot composition bundles and logs in without Node globals", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nyte-copilot-browser-"));
  try {
    const output = join(directory, "copilot.js");
    execFileSync(
      "pnpm",
      [
        "exec",
        "bun",
        "build",
        "--target=browser",
        "--format=iife",
        "test/fixtures/copilot-browser.ts",
        `--outfile=${output}`,
      ],
      { stdio: "pipe" },
    );
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode({ interval: 0.001 }),
      [TOKEN]: () => json({ access_token: "github-secret" }),
      [EXCHANGE]: () => sessionToken(),
      [MODELS]: () => json({ data: [{ id: "claude-sonnet-4.6", model_picker_enabled: true }] }),
    });
    const result = Promise.withResolvers<unknown>();
    const events: unknown[] = [];
    runInNewContext(
      readFileSync(output, "utf8"),
      {
        fetch: transport.fetch,
        AbortController,
        AbortSignal,
        URL,
        URLSearchParams,
        Headers,
        Request,
        Response,
        ReadableStream,
        TextEncoder,
        TextDecoder,
        setTimeout,
        clearTimeout,
        crypto: globalThis.crypto,
        postMessage: (message: unknown) => {
          // A real browser bridge clones messages into the receiving realm.
          const received: unknown = structuredClone(message);
          events.push(received);
          if (
            typeof received === "object" &&
            received !== null &&
            "type" in received &&
            (received.type === "complete" || received.type === "failed")
          )
            result.resolve(received);
        },
      },
      { timeout: 5000 },
    );
    const completed = await result.promise;
    assert.ok(Value.Check(CompletionSchema, completed), JSON.stringify(completed));
    assert.deepEqual(completed.models, ["claude-sonnet-4.6"]);
    assert.equal(completed.apiKey, SESSION_TOKEN);
    assert.equal(completed.origin, ORIGIN);
    assert.ok(
      events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "device_code",
      ),
    );
    assert.equal(
      transport.requests
        .find((request) => request.url.endsWith("/v2/token"))
        ?.headers.get("authorization"),
      "Bearer github-secret",
    );
    assert.equal(
      transport.requests
        .find((request) => request.url.endsWith("/models"))
        ?.headers.get("authorization"),
      `Bearer ${SESSION_TOKEN}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
