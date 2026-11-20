import { asId, HELLO_MAX_BYTES, SdkError } from "@nyte-ai/schema";
import type { ActionDeclaration, Json, PrincipalId } from "@nyte-ai/schema";
import type { ActionHandler } from "@nyte-ai/sdk/client";
import { afterEach, expect, test } from "vitest";
import { appActions } from "../data/app-actions.ts";
import { preferences } from "../preferences/index.ts";
import { actionDeclarations, offerActions } from "./offered-actions.ts";

const OWN = asId<"principal">("local");

const OTHER = asId<"principal">("device-phone");

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  preferences.remoteControl.set(false);
});

function offered(): ReadonlyMap<string, ActionHandler> {
  const handlers = new Map<string, ActionHandler>();

  offerActions({
    principal: OWN,
    offer(action: ActionDeclaration, handler: ActionHandler) {
      handlers.set(action.name, handler);

      return () => handlers.delete(action.name);
    },
  });

  return handlers;
}

async function ask(principal: PrincipalId, action: string, input: Json): Promise<Json | string> {
  const handler = offered().get(action);

  if (handler === undefined) return "not offered";

  try {
    return await handler(input, { client: asId<"client">("asker"), principal });
  } catch (error) {
    if (!(error instanceof SdkError)) throw error;

    return error.code;
  }
}

test.each<{
  readonly name: string;
  readonly principal: PrincipalId;
  readonly remoteControl: boolean;
  readonly action: string;
  readonly expected: Json | string;
}>([
  {
    name: "its own principal, switch off",
    principal: OWN,
    remoteControl: false,
    action: "chat.new",
    expected: { ran: "chat.new" },
  },
  {
    name: "its own principal, switch on",
    principal: OWN,
    remoteControl: true,
    action: "chat.new",
    expected: { ran: "chat.new" },
  },
  {
    name: "another principal, switch off",
    principal: OTHER,
    remoteControl: false,
    action: "chat.new",
    expected: "denied",
  },
  {
    name: "another principal, switch on",
    principal: OTHER,
    remoteControl: true,
    action: "chat.new",
    expected: { ran: "chat.new" },
  },
  {
    name: "another principal asking for a setting, switch off",
    principal: OTHER,
    remoteControl: false,
    action: "setting.theme",
    expected: "denied",
  },
  {
    name: "the switch itself is not an action",
    principal: OWN,
    remoteControl: false,
    action: "setting.remote.control",
    expected: "not offered",
  },
])("the app answers $name", async (row) => {
  preferences.remoteControl.set(row.remoteControl);
  stops.push(appActions.serve((name) => ({ ran: name })));

  expect(await ask(row.principal, row.action, {})).toEqual(row.expected);
});

test("everything the app declares fits in the one hello frame that carries it", () => {
  const hello = new TextEncoder().encode(JSON.stringify(actionDeclarations())).length;

  expect(hello).toBeLessThan(HELLO_MAX_BYTES - 1024);
});
