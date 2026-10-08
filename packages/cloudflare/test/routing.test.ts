import assert from "node:assert/strict";
import { test } from "vitest";
import { routeNyteRequest } from "../src/routing.ts";

test("authentication precedes object resolution", async () => {
  let resolved = false;

  const response = await routeNyteRequest({
    request: new Request("https://app.test/v1/info"),
    authorize: () => ({ kind: "deny", status: 401 }),
    namespace: {
      getByName: () => {
        resolved = true;

        return { fetch: async () => new Response() };
      },
    },
  });

  assert.equal(response.status, 401);
  assert.equal(resolved, false);
});

test("verified tenant and environment select the object, not the caller's query", async () => {
  const keys: string[] = [];

  const namespace = {
    getByName(name: string) {
      keys.push(name);

      return {
        fetch: async (request: Request) => {
          assert.equal(new URL(request.url).pathname, "/v1/info");

          return new Response("ok");
        },
      };
    },
  };

  for (const [tenant, environment] of [
    ["a/b", "c"],
    ["a", "b/c"],
  ]) {
    const response = await routeNyteRequest({
      request: new Request("https://app.test/nyte/v1/info?tenant=forged"),
      prefix: "/nyte",
      namespace,
      authorize: () => ({ kind: "allow", tenant, environment }),
    });

    assert.equal(await response.text(), "ok");
  }

  assert.deepEqual(keys, ['["a/b","c"]', '["a","b/c"]']);
});
