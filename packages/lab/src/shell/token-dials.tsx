import { DialStore, useDialKitController } from "dialkit";
import type { DialKitController } from "dialkit";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Appearance, TokenSet } from "./chrome";
import { readTokenBaselines, tokenConfig, strings } from "./token-catalog";
import type { TokenBaselines } from "./token-catalog";

type ProfileValues = DialKitController<ReturnType<typeof tokenConfig>>["values"];

const properties = new Map<string, string>(strings);

function disabled(group: Record<string, { override: boolean }>) {
  const updates: Record<string, { override: boolean }> = {};

  for (const name of Object.keys(group)) updates[name] = { override: false };

  return updates;
}

function useProfile(baseline: TokenBaselines[TokenSet], set: TokenSet, appearance: Appearance) {
  const config = useMemo(() => tokenConfig(baseline, set), [baseline, set]);

  const controller = useDialKitController(
    set === "nyte" ? "A · Desktop tokens" : "B · Calendar tokens",
    config,
    {
      id: `nyte-lab-${set}-${appearance}-individual-v1`,
      persist: true,
      defaultCollapsed: set !== "nyte",
      onAction: (action: string): void => {
        if (action === "reset") controller.resetValues();

        if (action === "disableAll") {
          const current = controller.getValues();
          controller.setValues({
            geometry: disabled(current.geometry),
            palette: disabled(current.palette),
            shadows: {
              ink: disabled(current.shadows.ink),
              stacks: disabled(current.shadows.stacks),
            },
            typography: disabled(current.typography),
            material: disabled(current.material),
          });
        }
      },
    },
  );

  return controller;
}

function overrides(values: ProfileValues) {
  const result: Record<string, string> = {};

  for (const [name, setting] of Object.entries(values.geometry)) {
    if (setting.override && Number.isFinite(setting.value)) result[name] = `${setting.value}px`;
  }

  for (const [name, setting] of Object.entries(values.material)) {
    if (setting.override && Number.isFinite(setting.value)) result[name] = `${setting.value}%`;
  }

  for (const [name, setting] of Object.entries(values.palette)) {
    if (setting.override && CSS.supports("color", setting.value)) result[name] = setting.value;
  }

  for (const [name, setting] of Object.entries(values.typography)) {
    const property = properties.get(name);

    if (property !== undefined && setting.override && CSS.supports(property, setting.value))
      result[name] = setting.value;
  }

  for (const [name, setting] of Object.entries(values.shadows.ink)) {
    if (setting.override && CSS.supports("color", setting.value)) result[name] = setting.value;
  }

  for (const [name, setting] of Object.entries(values.shadows.stacks)) {
    if (setting.override && CSS.supports("box-shadow", setting.value)) result[name] = setting.value;
  }

  /*
   * Depth is a bare multiplier rather than a length, and it is the one control
   * with no override toggle: shadow.css rests at 1, so writing the number
   * unconditionally keeps the slider and the surface in step.
   */
  for (const [name, value] of Object.entries(values.shadows.depth)) {
    if (Number.isFinite(value)) result[name] = `${value}`;
  }

  return result;
}

/*
 * Two profiles over one fixture. Override off inherits the desktop token and
 * each toggle keeps its value while off, so A and B can disagree on a token
 * without either forgetting what it had. Values persist per appearance, which
 * is also why the appearance keys this component: remounting re-reads the
 * baselines the dials start from.
 */
export function TokenDials({
  preview,
  active,
  onActive,
  appearance,
}: {
  preview: Document;
  active: TokenSet;
  onActive: (set: TokenSet) => void;
  appearance: Appearance;
}) {
  const [baselines] = useState<TokenBaselines>(() => readTokenBaselines(preview, appearance));
  const desktop = useProfile(baselines.nyte, "nyte", appearance);
  const calendar = useProfile(baselines.calendar, "calendar", appearance);
  const applied = useRef<string[]>([]);
  const setDesktopOpen = desktop.setOpen;
  const setCalendarOpen = calendar.setOpen;
  const values = active === "nyte" ? desktop.values : calendar.values;
  const css = useMemo(() => overrides(values), [values]);

  useLayoutEffect(() => {
    const root = preview.documentElement;

    for (const name of applied.current) if (!(name in css)) root.style.removeProperty(name);

    for (const [name, value] of Object.entries(css)) root.style.setProperty(name, value);
    root.style.removeProperty("--nyte-sidebar-width");
    applied.current = Object.keys(css);
  }, [preview, css]);

  useLayoutEffect(
    () => () => {
      for (const name of applied.current) preview.documentElement.style.removeProperty(name);
    },
    [preview],
  );

  useLayoutEffect(() => {
    setDesktopOpen(active === "nyte");
    setCalendarOpen(active === "calendar");
  }, [active, setDesktopOpen, setCalendarOpen]);

  useEffect(
    () =>
      DialStore.subscribePanelOpen((id, open) => {
        if (!open) return;

        if (id === `nyte-lab-nyte-${appearance}-individual-v1`) onActive("nyte");

        if (id === `nyte-lab-calendar-${appearance}-individual-v1`) onActive("calendar");
      }),
    [appearance, onActive],
  );

  return null;
}
