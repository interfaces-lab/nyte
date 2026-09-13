import { createNyteModels } from "@nyte-ai/ai";
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
    const unavailable = createNyteModels()
      .getModels("github-copilot")
      .find((model) => model.id !== "claude-sonnet-4.6");
    if (unavailable === undefined) throw new Error("Expected another generated Copilot model");

    const saved = {
      ...settings,
      defaultProvider: "github-copilot",
      defaultModel: unavailable.id,
    };
    expect(hostFallbacks(runtime, saved, flags).model.id).toBe("claude-sonnet-4.6");
    expect(() => hostFallbacks(runtime, settings, { ...flags, model: unavailable.id })).toThrow(
      `Unavailable github-copilot model: ${unavailable.id}`,
    );
  });
});

describe("signed-out launch with an explicit provider", () => {
  test("GitHub Copilot opens on generated baked models so login remains reachable", async () => {
    home = await mkdtemp(join(tmpdir(), "nyte-run-"));
    process.env["NYTE_HOME"] = home;
    const settings = await new FileSettingsStore(join(home, "settings.json")).read(home);
    const explicit = { ...flags, provider: "github-copilot" };

    expect(await resolveRuntime(explicit, settings)).toBeUndefined();
    const runtime = await signedOutRuntime(explicit, settings);
    expect(hostFallbacks(runtime, settings, explicit).model.provider).toBe("github-copilot");
  });
});
