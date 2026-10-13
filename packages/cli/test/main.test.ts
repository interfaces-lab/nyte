import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fakeModels } from "@nyte-ai/host/bench";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** Returns a temporary home and working directory, removed after the test. */
async function place(): Promise<{ readonly home: string; readonly cwd: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-cli-")));
  folders.push(root);
  const home = join(root, "home");
  const cwd = join(root, "work");
  await Promise.all([mkdir(home), mkdir(cwd)]);

  return { home, cwd };
}

describe("nyte -p", () => {
  it("prints the answer and exits 0 when the run completes", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Hello from the model." }] });
    const out: string[] = [];
    const err: string[] = [];

    const code = await main(["-p", "Say hello."], {
      ...(await place()),
      models: fake.models,
      stdout: (chunk) => out.push(chunk),
      stderr: (chunk) => err.push(chunk),
    });

    expect({ code, out: out.join(""), err: err.join("") }).toEqual({
      code: 0,
      out: "Hello from the model.\n",
      err: "",
    });
    expect(fake.requests).toHaveLength(1);
  });

  it("selects --provider and --model, and refuses one without the other", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Picked." }] });
    const out: string[] = [];

    const options = {
      ...(await place()),
      models: fake.models,
      stdout: (chunk: string) => out.push(chunk),
    };

    expect(
      await main(["--provider", "test", "-p", "Hi."], { ...options, stderr: () => undefined }),
    ).toBe(2);
    expect(
      await main(["--provider", "test", "--model", "model", "--print", "--", "Hi."], options),
    ).toBe(0);
    expect(out.join("")).toBe("Picked.\n");
    expect(fake.requests.map((request) => request.model.id)).toEqual(["model"]);
  });

  it("makes --provider and --model the host's default model, and refuses an unknown one", async () => {
    const model = {
      name: "Model",
      api: "test-api",
      provider: "test",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text" as const],
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000,
      maxTokens: 4_096,
    };
    const fake = fakeModels({
      models: [
        { ...model, id: "first" },
        { ...model, id: "second" },
      ],
    });
    fake.reply({ content: [{ type: "text", text: "One." }] });
    fake.reply({ content: [{ type: "text", text: "Two." }] });
    const err: string[] = [];

    const options = {
      ...(await place()),
      models: fake.models,
      stdout: () => undefined,
      stderr: (chunk: string) => err.push(chunk),
    };

    expect(await main(["-p", "--provider", "test", "--model", "second", "Hi."], options)).toBe(0);
    expect(await main(["-p", "Again."], options)).toBe(0);
    expect(fake.requests.map((request) => request.model.id)).toEqual(["second", "second"]);
    expect(await main(["-p", "--provider", "test", "--model", "none", "Hi."], options)).toBe(2);
    expect(err.join("")).toBe("Unknown model: test/none.\n");
  });

  it("exits 1 with the failure when the run fails", async () => {
    const fake = fakeModels();
    fake.reply({ error: "The provider refused." });
    const err: string[] = [];

    const code = await main(["-p", "Fail."], {
      ...(await place()),
      models: fake.models,
      stdout: () => undefined,
      stderr: (chunk) => err.push(chunk),
    });

    expect(code).toBe(1);
    expect(err.join("")).toContain("The provider refused.");
  });
});

describe("nyte serve", () => {
  it("listens with the token, answers /.nyte/describe, and exits 0 when stopped", async () => {
    const stop = new AbortController();
    const bound = Promise.withResolvers<string>();

    const serving = main(["serve", "--token", "a-token-of-16-chars"], {
      ...(await place()),
      models: fakeModels().models,
      signal: stop.signal,
      stdout: (chunk) => bound.resolve(chunk.trim()),
    });

    const response = await fetch(`${await bound.promise}/.nyte/describe`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: hostname() });
    stop.abort();
    expect(await serving).toBe(0);
  });
});
