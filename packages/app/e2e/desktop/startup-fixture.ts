import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { dev } from "@nyte-ai/core";
import { sdk } from "@nyte-ai/sdk";
import { e2eModels } from "../../../desktop/src/main/fixtures/e2e-models.ts";
import { FIXTURES, prepareHome } from "./baseline.ts";

export const startupCases = ["fresh", "restored", "heavy"] as const;

export type StartupCase = (typeof startupCases)[number];

export interface StartupFixture {
  readonly scenario: StartupCase;
  readonly directory: string;
  readonly home: string;
  readonly profile: string;
  readonly sessions: number;
  readonly turns: number;
  readonly storeBytes: number;
  readonly expected:
    | { readonly kind: "empty" }
    | { readonly kind: "chat"; readonly title: string; readonly lastMessage: string };
}

export async function prepareStartupFixture(
  directory: string,
  scenario: StartupCase,
): Promise<StartupFixture> {
  const home = join(directory, "home");
  const profile = join(directory, "profile");
  await mkdir(profile, { recursive: true, mode: 0o700 });

  if (scenario === "fresh") {
    await mkdir(home, { mode: 0o700 });

    return {
      scenario,
      directory,
      home,
      profile,
      sessions: 0,
      turns: 0,
      storeBytes: 0,
      expected: { kind: "empty" },
    };
  }

  dev.off();
  const prepared = await prepareHome(directory);

  const host = await sdk.open({
    home,
    workspace: { kind: "local", path: home },
    models: e2eModels().models,
  });

  const target = scenario === "heavy" ? "long" : "beta";
  const marker = `Startup ${scenario} fixture ready`;
  let sessionCount = 0;
  let turns = 0;

  try {
    if (scenario === "heavy") {
      for (let index = 0; index < 200; index++) {
        const session = await host.sessions.create({ name: `History ${index + 1}` });
        const receipt = await session.send(`/long 8 History ${index + 1}`);
        const outcome = await receipt.settled();

        if (outcome.kind !== "completed")
          throw new Error(`Seeding history ${index + 1} failed: ${outcome.kind}`);
      }
    }

    const receipt = await host.session(prepared.sessions[target]).send(marker);
    const outcome = await receipt.settled();

    if (outcome.kind !== "completed") throw new Error(`Seeding ${target} failed: ${outcome.kind}`);
    let page = await host.sessions.list({ parents: { kind: "all" } });
    const rows = [...page.items];

    while (page.next !== null) {
      page = await host.sessions.list({ parents: { kind: "all" }, cursor: page.next });
      rows.push(...page.items);
    }

    sessionCount = rows.length;

    for (const row of rows) {
      const view = await host.session(row.id).view();
      turns += view.messages.filter((message) => message.kind === "user").length;
    }
  } finally {
    await host.close();
  }

  return {
    scenario,
    directory,
    home,
    profile,
    sessions: sessionCount,
    turns,
    storeBytes: (await stat(join(home, ".nyte", "nyte.db"))).size,
    expected: { kind: "chat", title: FIXTURES[target], lastMessage: `Echo: ${marker}` },
  };
}
