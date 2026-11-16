import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pushedCiRepo } from "@nyte-ai/app/e2e/scenario-d";
import { ciHome } from "@nyte-ai/bench";
import type { CiRepo, CiRoute, ScenarioHome } from "@nyte-ai/bench";
import { dev } from "@nyte-ai/core";
import { sdk } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export interface CiDesktopHome extends AsyncDisposable {
  readonly home: ScenarioHome;
  readonly repo: CiRepo;
}

export async function ciDesktopHome(parent: string, route: CiRoute): Promise<CiDesktopHome> {
  const repo = await pushedCiRepo(parent);
  const home = await ciHome({ route, root: parent });
  const profile = `export PATH='${repo.path.replaceAll("'", "'\\''")}'\n`;
  await writeFile(join(home.home, ".zshrc"), profile);
  await writeFile(join(home.home, ".profile"), profile);
  dev.off();
  const host = await sdk.open({ home: home.home, workspace: { kind: "local", path: repo.root } });
  await host.close();

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

export type CiRequest = Static<typeof CiRequestSchema>;

export function readCiRequests(output: string): readonly CiRequest[] {
  return output
    .split("\n")
    .flatMap((line) =>
      line.startsWith("NYTE_E2E_CI ")
        ? [Value.Parse(CiRequestSchema, JSON.parse(line.slice("NYTE_E2E_CI ".length)))]
        : [],
    );
}
