/**
 * Host settings as `Setting`s. The value is whatever main last answered or
 * pushed, held in one query entry. A change goes to main, and main's answer is
 * what every window shows. Nothing is optimistic, so a refused change never
 * appears made.
 */
import { hashKey } from "@tanstack/react-query";
import type { HostSettingKey, HostSettings, HostSettingsPatch } from "@nyte-ai/host/settings";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import { nyte } from "../nyte.ts";
import { queryClient } from "../queries.ts";
import { keys } from "../query-keys.ts";
import type { Setting } from "./store.ts";

const HASH = hashKey(keys.hostSettings);

/**
 * The settings route's loader: host rows render with their values, never empty
 * first. A file that can't be read leaves those rows disabled, not the whole page.
 */
export async function loadHostSettings(): Promise<void> {
  const bridge = nyte.host.settings;

  if (bridge === undefined) return;

  try {
    await queryClient.ensureQueryData({
      queryKey: keys.hostSettings,
      queryFn: () => bridge.get(),
      staleTime: Number.POSITIVE_INFINITY,
    });
  } catch (cause) {
    toast.add({ title: errorMessage(cause) });
  }
}

/** Main pushed the file's new values: from this window, another, the terminal UI, or a hand edit. */
export function acceptHostSettings(settings: HostSettings): void {
  queryClient.setQueryData(keys.hostSettings, settings);
}

/** Resolves once main has written the file, so a dependent action sees the new value. */
export async function changeHostSettings(patch: HostSettingsPatch): Promise<void> {
  const bridge = nyte.host.settings;

  if (bridge === undefined) return;

  try {
    acceptHostSettings(await bridge.set(patch));
  } catch (cause) {
    toast.add({ title: errorMessage(cause) });
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
