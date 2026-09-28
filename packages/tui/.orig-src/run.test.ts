import { FileModelsStore } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/ai";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunFlags } from "./flags.ts";
import { hostFallbacks, resolveRuntime, signedOutRuntime } from "./run.ts";
import { FileSettingsStore } from "./settings.ts";

const flags: RunFlags = {
  resume: { kind: "new" },
  print: false,
  json: false,
  quiet: false,
  rest: [],
};

const previousHome = process.env["NYTE_HOME"];
const previousModel = process.env["NYTE_MODEL"];
let home = "";

function copilotModel(id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider: "github-copilot",
    baseUrl: "https://api.githubcopilot.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 4_096,
  };
}

beforeEach(() => {
  delete process.env["NYTE_MODEL"];
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["NYTE_HOME"];
  else process.env["NYTE_HOME"] = previousHome;
  if (previousModel === undefined) delete process.env["NYTE_MODEL"];
  else process.env["NYTE_MODEL"] = previousModel;
  if (home !== "") await rm(home, { recursive: true, force: true });
  home = "";
});

async function copilotHome(availableModelIds?: readonly string[]) {
  home = await mkdtemp(join(tmpdir(), "nyte-run-"));
  process.env["NYTE_HOME"] = home;
  const credential = {
    type: "oauth",
    access: "copilot-token",
    refresh: "github-token",
    expires: Number.MAX_SAFE_INTEGER,
    ...(availableModelIds === undefined ? {} : { availableModelIds: [...availableModelIds] }),
  } as const;
  await writeFile(join(home, "auth.json"), JSON.stringify({ "github-copilot": credential }));
  await new FileModelsStore().write("github-copilot", {
    models: [copilotModel("claude-sonnet-4.6"), copilotModel("alternate")],
    checkedAt: Date.now(),
  });

  return new FileSettingsStore(join(home, "settings.json")).read(home);
}

describe("launch runtime with a GitHub Copilot sign-in", () => {
  test("a credential without an account model filter does not seed the launch", async () => {
    const settings = await copilotHome();
    expect(
      await resolveRuntime({ ...flags, provider: "github-copilot" }, settings),
    ).toBeUndefined();
  });

  test("the credential's available IDs select generated models offline", async () => {
    const settings = await copilotHome(["claude-sonnet-4.6"]);
    const explicit = { ...flags, provider: "github-copilot" };
    const runtime = await resolveRuntime(explicit, settings);

    if (runtime === undefined) throw new Error("Expected a GitHub Copilot runtime");
    expect(hostFallbacks(runtime, settings, explicit).model).toMatchObject({
      provider: "github-copilot",
      id: "claude-sonnet-4.6",
    });
  });

  test("an unavailable saved default falls back while an explicit model is rejected", async () => {
    const settings = await copilotHome(["claude-sonnet-4.6"]);
    const runtime = await resolveRuntime({ ...flags, provider: "github-copilot" }, settings);
    if (runtime === undefined) throw new Error("Expected a GitHub Copilot runtime");
    const unavailable = "alternate";
    const saved = {
      ...settings,
      defaultProvider: "github-copilot",
      defaultModel: unavailable,
    };
    expect(hostFallbacks(runtime, saved, flags).model.id).toBe("claude-sonnet-4.6");
    expect(() => hostFallbacks(runtime, settings, { ...flags, model: unavailable })).toThrow(
      `Unavailable github-copilot model: ${unavailable}`,
    );
  });
});

describe("signed-out launch with an explicit provider", () => {
  test("GitHub Copilot opens from a persisted catalog so login remains reachable", async () => {
    const settings = await copilotHome();
    await writeFile(join(home, "auth.json"), "{}");
    const explicit = { ...flags, provider: "github-copilot" };

    expect(await resolveRuntime(explicit, settings)).toBeUndefined();
    const runtime = await signedOutRuntime(explicit, settings);
    expect(hostFallbacks(runtime, settings, explicit).model.provider).toBe("github-copilot");
  });
});
