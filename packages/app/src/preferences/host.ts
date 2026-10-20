import { hashKey } from "@tanstack/react-query";
import type { HostSettingKey, HostSettings, HostSettingsPatch } from "../bridge.ts";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import { nyte } from "../nyte.ts";
import { queryClient } from "../queries.ts";
import { keys } from "../query-keys.ts";
import type { Setting } from "./store.ts";

const HASH = hashKey(keys.hostSettings);

export async function loadHostSettings(): Promise<void> {
  const bridge = nyte.host.settings;

  if (bridge === undefined) return;

  try {
    await queryClient.ensureQueryData({
      queryKey: keys.hostSettings,
      queryFn: () => bridge.get(),
    });
  } catch (cause) {
    toast.add({ type: "error", title: errorMessage(cause) });
  }
}

export function acceptHostSettings(settings: HostSettings): void {
  queryClient.setQueryData(keys.hostSettings, settings);
}

export async function changeHostSettings(patch: HostSettingsPatch): Promise<void> {
  const bridge = nyte.host.settings;

  if (bridge === undefined) return;

  try {
    acceptHostSettings(await bridge.set(patch));
  } catch (cause) {
    toast.add({ type: "error", title: errorMessage(cause) });
  }
}

export function hostSetting<K extends HostSettingKey>(key: K): Setting<HostSettings[K]> {
  return {
    get: () => queryClient.getQueryData<HostSettings>(keys.hostSettings)?.[key],
    set: (value) => {
      const patch: { -readonly [P in HostSettingKey]?: HostSettings[P] } = {};
      patch[key] = value;
      void changeHostSettings(patch);
    },
    subscribe: (listener) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === HASH) listener();
      }),
    available: () => nyte.host.settings !== undefined,
  };
}
