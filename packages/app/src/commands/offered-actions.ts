import { isJson, SdkError } from "@nyte-ai/schema";
import type { ActionDeclaration, Json } from "@nyte-ai/schema";
import type { ClientConnection } from "@nyte-ai/sdk/client";
import type { RegisteredRouter } from "@tanstack/react-router";
import { Value } from "typebox/value";
import { APP_ACTIONS, namesAppAction } from "../contract/client-actions.ts";
import { appActions } from "../data/app-actions.ts";
import { connection, currentConnection, onInstall } from "../data/connection.ts";
import {
  namesSettingAction,
  runSettingAction,
  settingDeclarations,
} from "../preferences/actions.ts";
import { preferences } from "../preferences/index.ts";
import { runAction } from "./window-commands.ts";

/**
 * Runs the action or setting action `name` for a caller that knows it only by name. Throws
 * `not_supported` for a name the app does not have, `invalid` for input it does not take, and
 * `unavailable` when the action has nothing to act on now.
 */
export function performAction(router: RegisteredRouter, name: string, input: Json): Json {
  if (namesSettingAction(name)) return runSettingAction(name, input);

  if (!namesAppAction(name)) throw new SdkError("not_supported", `This app has no action ${name}.`);

  if (!Value.Check(APP_ACTIONS[name].input, input))
    throw new SdkError("invalid", `That is not the input ${name} takes.`);

  if (!runAction(router, name, input))
    throw new SdkError("unavailable", `${name} has nothing to act on right now.`);

  return null;
}

/** Every action the app declares to its host: its own, then one per setting. */
export function actionDeclarations(): readonly ActionDeclaration[] {
  return [
    ...Object.entries(APP_ACTIONS).map((entry) => {
      const input: unknown = JSON.parse(JSON.stringify(entry[1].input));

      if (!isJson(input)) throw new Error(`The schema of ${entry[0]} is not JSON.`);

      return { name: entry[0], summary: entry[1].summary, input };
    }),
    ...settingDeclarations(),
  ];
}

/**
 * Declares the app's actions on `link` and answers requests for them. A request runs when it comes
 * from the principal this app connected as, or from anyone once Remote Control is on. Any other is
 * refused with `denied`.
 */
export function offerActions(link: Pick<ClientConnection, "principal" | "offer">): void {
  for (const declaration of actionDeclarations())
    link.offer(declaration, (input, requester) => {
      if (requester.principal !== link.principal && !preferences.remoteControl.get())
        throw new SdkError(
          "denied",
          "This app runs requests from its own user only. To let your other devices drive it, turn on Remote control in Settings > Server.",
        );

      return appActions.run(declaration.name, input);
    });
}

onInstall(() => offerActions(connection()));

const installed = currentConnection();

if (installed !== undefined) offerActions(installed);
