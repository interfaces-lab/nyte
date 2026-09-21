import { create, props } from "@stylexjs/stylex";
import { DialRoot, DialStore, useDialKitController } from "dialkit";
import type { DialKitController } from "dialkit";
import "dialkit/styles.css";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Appearance, TokenSet } from "./chrome";
import { tokenConfig, strings } from "./token-catalog";
import type { TokenBaselines } from "./token-catalog";

type ProfileValues = DialKitController<ReturnType<typeof tokenConfig>>["values"];

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
            typographyAndShadows: disabled(current.typographyAndShadows),
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
  for (const [name, property] of strings) {
    const setting = values.typographyAndShadows[name];
    if (setting?.override && CSS.supports(property, setting.value)) result[name] = setting.value;
  }
  return result;
}

const styles = create({
  dock: {
    position: "fixed",
    zIndex: 1100,
    insetBlockStart: 12,
    insetBlockEnd: 100,
    insetInlineEnd: 12,
    width: "min(440px, calc(100vw - 24px))",
    overflowY: "auto",
    borderRadius: 12,
    backgroundColor: "#202022",
    color: "#ddd",
    boxShadow: "0 16px 48px #0006",
    font: "12px/18px system-ui, sans-serif",
  },
  hidden: { display: "none" },
  note: { margin: 0, padding: "12px 16px", color: "#a1a1aa" },
});

export function TokenDials({
  preview,
  baselines,
  active,
  onActive,
  appearance,
  open,
}: {
  preview: Document;
  baselines: TokenBaselines;
  active: TokenSet;
  onActive: (set: TokenSet) => void;
  appearance: Appearance;
  open: boolean;
}) {
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

  return (
    <aside aria-label="DialKit controls" {...props(styles.dock, !open && styles.hidden)}>
      <p {...props(styles.note)}>
        Override off inherits the desktop token. Each toggle retains its value when off. A and B
        keep separate values and versions, saved per appearance. Enter a slider to type a number;
        geometry steps are 0.01px. Sidebar reveal never changes the rail width.
      </p>
      {open && <DialRoot mode="inline" theme="dark" defaultOpen productionEnabled />}
    </aside>
  );
}
