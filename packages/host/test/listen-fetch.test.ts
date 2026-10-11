import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import type { ExecutionCoverage, Owned } from "@nyte-ai/schema";
import type { Listener } from "@nyte-ai/core";
import { decodeError, errorStatus, operations } from "@nyte-ai/protocol";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { listenFetch } from "../src/listen-fetch.ts";
import { fakeModels, open } from "./fake-models.ts";

const TOKEN = "a-token-of-at-least-16";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function post(listener: Listener, name: string, authorization: string): Promise<Response> {
  return listener.fetch(
    new Request(`http://host.test/${name}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

describe("listenFetch", () => {
  it("serves the protocol with no socket, the token compared through Web Crypto", async () => {
    const host = await open(fakeModels(), { operations: operations() });
    cleanups.push(() => host.close());

    const listener = await listenFetch(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    cleanups.push(() => listener.close());

    expect(listener.address).toBeNull();
    expect((await post(listener, "sessions.list", `Bearer ${TOKEN}`)).status).toBe(200);

    for (const authorization of [`Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, ""]) {
      const refused = await post(listener, "sessions.list", authorization);

      expect(refused.status).toBe(401);
      expect(decodeError(JSON.parse(await refused.text()), refused.status).code).toBe(
        "unauthenticated",
      );
    }

    await expect(
      listenFetch(host, { transport: { kind: "fetch" }, auth: { kind: "token", token: "short" } }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("treats a dispatch kernel as admit-only: no in-process driver and no cover (§42v)", async () => {
    const dispatched: string[] = [];
    const covered: ExecutionCoverage[] = [];

    const host = await open(fakeModels(), {
      operations: operations(),
      execution: {
        kind: "dispatch",
        dispatch: async ({ session }) => {
          dispatched.push(session);
        },
      },
    });

    cleanups.push(() => host.close());

    const listener = await listenFetch(
      {
        ...host,
        execution: {
          ...host.execution,
          cover: async (coverage): Promise<Owned> => {
            covered.push(coverage);

            return host.execution.cover(coverage);
          },
        },
      },
      { transport: { kind: "fetch" }, auth: { kind: "token", token: TOKEN } },
    );

    cleanups.push(() => listener.close());
    const session = await host.sessions.create();
    await session.send("Go.");

    expect(covered).toEqual([]);
    expect(dispatched).toEqual([session.id]);
  });

  it("fails job.output for a job this instance does not hold before any stream opens (§42aa)", async () => {
    const host = await open(fakeModels(), { operations: operations() });
    cleanups.push(() => host.close());

    const listener = await listenFetch(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    cleanups.push(() => listener.close());

    const response = await listener.fetch(
      new Request("http://host.test/job.output", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: host.kernel.defaultWorkspace, job: "no-such-job" }),
      }),
    );

    expect(response.status).toBe(errorStatus.unavailable);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(decodeError(JSON.parse(await response.text()), response.status).code).toBe(
      "unavailable",
    );
  });

  it("reaches no node: module through the whole import graph of a Worker's entries (§41j)", async () => {
    for (const entry of [
      "../src/listen-fetch.ts",
      "../src/durable-object.ts",
      "../src/providers.ts",
      "../src/deploy/cloudflare/worker.ts",
    ]) {
      const built = await build({
        entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "es2023",
        mainFields: ["module", "main"],
        conditions: ["workerd", "worker", "browser"],
        external: ["node:*", "cloudflare:*"],
        write: false,
        metafile: true,
        logLevel: "silent",
      });

      const inputs = Object.entries(built.metafile.inputs);

      const reached = inputs.flatMap(([file, input]) =>
        input.imports.flatMap((imported) =>
          imported.path.startsWith("node:") || builtinModules.includes(imported.path)
            ? [`${file} -> ${imported.path}`]
            : [],
        ),
      );

      expect(inputs.length).toBeGreaterThan(1);
      expect([entry, reached]).toEqual([entry, []]);
    }
  }, 60_000);
});
