import { isJson } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { errorMessage } from "../errors.ts";
import { connected, hostWatch } from "../sdk.tsx";
import type { Setting } from "./store.ts";

export function pluginSetting<S extends TSchema>(id: string, schema: S): Setting<Static<S>> {
  const store = hostWatch("host");

  return {
    get: () => {
      const value = store.getState().value?.settings.find((setting) => setting.id === id)?.value;

      return Value.Check(schema, value) ? value : undefined;
    },
    set: (value) => {
      if (isJson(value)) void applyPluginSetting(id, value);
    },
    subscribe: store.subscribeByFrame,
    available: () => true,
  };
}

async function applyPluginSetting(id: string, value: Json): Promise<void> {
  try {
    const outcome = await (await connected()).settings.apply(id, value);

    if (outcome.kind !== "applied") toast.add({ type: "error", title: "That value isn't valid" });
  } catch (cause) {
    toast.add({ type: "error", title: errorMessage(cause) });
  }
}
