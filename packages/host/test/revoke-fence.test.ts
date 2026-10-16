import { asId } from "@nyte-ai/schema";
import type { HeadName } from "@nyte-ai/schema";
import type { Store } from "@nyte-ai/core";
import { hostPrincipalsRef, memoryStore } from "@nyte-ai/core";
import { assert, describe, expect, it } from "vitest";
import { listen } from "../src/index.ts";
import { fakeModels, open } from "../src/bench/fake-models.ts";

const main: HeadName = asId("main");

describe("revoke fence", () => {
  it("rejects a device whose principal is revoked here while its token is read, caching and storing nothing (D6 audit 5)", async () => {
    const base = memoryStore();
    let revoke: () => Promise<void> = async () => undefined;

    const store: Store = {
      ...base,
      async open() {
        const connection = await base.open();

        return {
          ...connection,
          refs: {
            ...connection.refs,
            async get(name) {
              const read = await connection.refs.get(name);

              if (name === hostPrincipalsRef()) {
                const now = revoke;
                revoke = async () => undefined;
                await now();
              }

              return read;
            },
          },
        };
      },
    };

    const host = await open(fakeModels(), { store });
    const listener = await listen(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: "a-token-of-at-least-16" },
      execution: { kind: "admit-only" },
    });

    try {
      const session = await host.sessions.create();
      const { code } = await host.principals.pair({ authority: new Set(["participant"]) });
      const device = await host.server.redeem(code);
      assert(device !== null);
      revoke = () => host.principals.revoke(device.principal);

      const send = () =>
        listener.fetch(
          new Request("http://host.test/head.send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${device.token}`,
            },
            body: JSON.stringify({
              session: session.id,
              head: main,
              content: "after revoke",
              options: { id: "revoke-send" },
            }),
          }),
        );

      const first = await send();
      const second = await send();

      expect([first.status, second.status]).toEqual([401, 401]);
      expect(await host.principals.list()).toEqual([]);
      expect((await session.view()).messages.filter((message) => message.kind === "user")).toEqual(
        [],
      );
    } finally {
      await listener.close();
      await host.close();
    }
  });
});
