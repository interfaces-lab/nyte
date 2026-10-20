import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  CASSETTES,
  fakeModels,
  lastUserText,
  playCassette,
  simulate,
  titleReply,
} from "@nyte-ai/bench";
import type { Simulation } from "@nyte-ai/bench";
import { sdk } from "@nyte-ai/sdk";
import type { Store } from "../../src/app/store.ts";
import { startTui } from "../harness/tui.ts";

const idle = (store: Store): boolean => store.screen().run.kind === "idle";

async function listen(simulation: Simulation) {
  const outcome = await simulation.drive({ kind: "listen" });

  if (outcome.kind !== "listening") throw new Error(`Expected listening, got ${outcome.kind}.`);

  return sdk.connect({ url: outcome.url, credentials: { kind: "token", token: outcome.token } });
}

async function rootNames(simulation: Simulation): Promise<readonly (string | null)[]> {
  const outcome = await simulation.drive({ kind: "list" });

  return outcome.kind === "list" ? outcome.sessions.map((session) => session.name) : [];
}

test("a tool call replayed from an Anthropic Messages cassette reads the file, draws the answer, and its title lands in the list", async () => {
  const cassette = CASSETTES.anthropicToolUse;
  await using player = await playCassette({ cassette });
  await using simulation = await simulate({ models: player.models });
  await writeFile(join(simulation.workspace, "notes.txt"), "buy oat milk\ncall the landlord\n");
  await using tui = await startTui({ host: simulation.host });
  await tui.ready();

  await tui.send(cassette.prompt);
  await tui.frame((frame) => frame.includes(cassette.answer));
  await tui.state(idle);

  expect(tui.captureCharFrame()).toContain("notes.txt");

  for (let poll = 0; !(await rootNames(simulation)).includes("Reading my notes"); poll += 1) {
    if (poll > 300) throw new Error("The title never landed.");
    await Bun.sleep(10);
  }
});

test("follows its host through a kill and a restart on the same store and endpoint: the next message lands once, on the whole history", async () => {
  const fake = fakeModels({
    fallback: (request) => ({
      content: [{ type: "text", text: titleReply(request) ?? `Echo: ${lastUserText(request)}` }],
    }),
  });

  await using simulation = await simulate({ models: fake.models });
  await using connection = await listen(simulation);
  await using tui = await startTui({ host: connection });
  await tui.ready();

  await tui.send("before the restart");
  await tui.frame((frame) => frame.includes("Echo: before the restart"));
  await tui.state(idle);

  expect(await simulation.drive({ kind: "kill" })).toEqual({ kind: "killed" });
  expect(await simulation.drive({ kind: "restart" })).toEqual({ kind: "restarted" });

  await tui.send("after the restart");
  await tui.frame((frame) => frame.includes("Echo: after the restart"));
  await tui.state(idle);

  const asked = fake.requests.filter((request) => titleReply(request) === null);

  expect(asked.map(lastUserText)).toEqual(["before the restart", "after the restart"]);
  expect(JSON.stringify(asked[1]?.context.messages)).toContain("Echo: before the restart");
});
