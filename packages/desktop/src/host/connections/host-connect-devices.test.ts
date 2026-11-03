import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { DESKTOP_ROUTES } from "@nyte-ai/connect";
import { connectRouteHandler } from "@nyte-ai/connect/host";
import { cleanUp } from "../fixtures/connect-machine.ts";

afterEach(cleanUp);

test("on the loopback listener the desktop routes refuse browsers, other hosts, and forwarded requests", async () => {
  let bound: string | undefined;
  const reached: string[] = [];

  const handle = connectRouteHandler({
    host: () => bound,
    enroll: async () => {
      reached.push("enroll");

      return { kind: "empty" };
    },
    forget: async () => {
      reached.push("forget");

      return { kind: "empty" };
    },
  });

  const status = async (headers: Record<string, string>, url = "http://127.0.0.1:4100") => {
    const response = await handle(
      new Request(`${url}${DESKTOP_ROUTES.device}`, {
        method: "DELETE",
        headers: { authorization: "Bearer device", ...headers },
      }),
    );

    return response?.status;
  };

  const host = { host: "127.0.0.1:4100" };

  assert.equal(await status(host), 403, "before the listener is bound");
  bound = "127.0.0.1:4100";
  assert.equal(await status({ ...host, origin: "http://127.0.0.1:4100" }), 403);
  assert.equal(await status({ host: "attacker.example" }), 403);
  assert.equal(await status({ host: "127.0.0.1:4101" }), 403);
  assert.equal(await status({ host: "localhost:4100" }), 403);
  assert.equal(await status(host, "http://attacker.example"), 403);
  assert.equal(await status({ ...host, forwarded: "host=attacker.example" }), 403);
  assert.equal(await status({ ...host, "x-forwarded-host": "127.0.0.1:4100" }), 403);
  assert.deepEqual(reached, []);
  assert.equal(await status(host), 204);
  assert.deepEqual(reached, ["forget"]);
});
