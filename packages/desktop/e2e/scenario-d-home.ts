import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dev } from "@nyte-ai/core";
import { pushedCiRepo } from "@nyte-ai/app/e2e/scenario-d";
import { ciHome } from "@nyte-ai/host/bench";
import type { CiRepo, CiRoute, ScenarioHome } from "@nyte-ai/host/bench";
import { sdk } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { E2E_MODEL, e2eModels } from "../src/main/fixtures/e2e-models.ts";

/** Scenario D's home and repo, the repo seeded as the desktop's one workspace. */
export interface CiDesktopHome extends AsyncDisposable {
  readonly home: ScenarioHome;
  readonly repo: CiRepo;
}

/**
 * Builds scenario D under `parent`: the pushed temp git repo whose test fails, and a
 * home holding the CI skill, for `mcp` the CI MCP server, and an empty
 * `.zshrc` so a terminal's zsh starts at its prompt rather than its new-user
 * setup. The repo is seeded as a workspace and the scripted model as the
 * default.
 */
export async function ciDesktopHome(parent: string, route: CiRoute): Promise<CiDesktopHome> {
  const repo = await pushedCiRepo(parent);
  const home = await ciHome({ route, root: parent });
  await writeFile(join(home.home, ".zshrc"), "");
  dev.off();

  const host = await sdk.open({
    models: e2eModels().models,
    home: home.home,
    workspace: { kind: "local", path: repo.root },
  });

  try {
    await host.models.setDefault(E2E_MODEL);
  } finally {
    await host.close();
  }

  return {
    home,
    repo,
    [Symbol.asyncDispose]: async () => {
      await home[Symbol.asyncDispose]();
      await repo[Symbol.asyncDispose]();
    },
  };
}

const CiRequestSchema = Type.Object({
  tool: Type.Union([Type.String(), Type.Null()]),
  chars: Type.Number(),
  clipped: Type.Boolean(),
  head: Type.String(),
  tail: Type.String(),
});

/** What the scripted model read on one scenario D request: the tool whose result ended it, and that result's length, ends and whether the host clipped it. */
export type CiRequest = Static<typeof CiRequestSchema>;

/** The scenario D requests the desktop's scripted model printed as `NYTE_E2E_CI` lines, in order. */
export function readCiRequests(output: string): readonly CiRequest[] {
  return output
    .split("\n")
    .flatMap((line) =>
      line.startsWith("NYTE_E2E_CI ")
        ? [Value.Parse(CiRequestSchema, JSON.parse(line.slice("NYTE_E2E_CI ".length)))]
        : [],
    );
}
