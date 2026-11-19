import { asId } from "@nyte-ai/schema";
import type { SessionId, WorkspaceId } from "@nyte-ai/sdk";
import type { TestHost } from "../../test/fixture/host.ts";
import { answerText, userText } from "./content.ts";

export async function seedChat(fixture: TestHost, turns: number): Promise<SessionId> {
  const host = fixture.host;
  const workspace = await defaultWorkspace(fixture);
  const id = asId<"session">(crypto.randomUUID());

  for (let index = 0; index < turns; index++) {
    fixture.reply({ content: [{ type: "text", text: answerText(index) }] });
    const content = [{ kind: "text" as const, text: userText(index) }];

    const receipt =
      index === 0
        ? (await host.sessions.start({ id, workspace, configuration: {}, content })).receipt
        : await host.session(id).send(content);

    await receipt.settled();
  }

  return id;
}

async function defaultWorkspace(fixture: TestHost): Promise<WorkspaceId> {
  for await (const view of fixture.host.watch()) {
    if (view.defaultWorkspace !== null) return view.defaultWorkspace;
  }

  throw new Error("The test host has no default workspace.");
}
