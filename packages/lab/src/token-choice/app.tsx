import { create, props } from "@stylexjs/stylex";
import { DialRoot, DialStore, useDialKitController } from "dialkit";
import type { DialConfig } from "dialkit";
import "dialkit/styles.css";
import { useLayoutEffect, useRef, useState } from "react";
import { auditSurface, workbenchState } from "../shell/audit-state";
import { decisions } from "./decisions";
import {
  choicesFrom,
  decisionConfig,
  exportCss,
  resolveOverrides,
  resolvePreviewCss,
} from "./choices";
import type { Compare } from "./choices";
import { applyOverrides, applyPreviewCss, measure } from "./measure";
import type { Measured } from "./measure";

const previewConfig = {
  compare: {
    type: "select",
    options: [
      { value: "choices", label: "Choices" },
      { value: "v1", label: "All v1" },
      { value: "v2", label: "All v2" },
    ],
    default: "choices",
  },
  appearance: {
    type: "select",
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    default: "light",
  },
  surface: {
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "menu", label: "Menu" },
      { value: "submenu", label: "Submenu" },
      { value: "popover", label: "Popover" },
      { value: "dialog", label: "Dialog" },
    ],
    default: "none",
  },
  workbench: {
    type: "select",
    options: [
      { value: "rail", label: "Rail" },
      { value: "compact", label: "Icon rail" },
      { value: "panel", label: "Panel" },
    ],
    default: "rail",
  },
  sidebar: true,
  guides: false,
  copyCss: { type: "action", label: "Copy CSS" },
  reset: { type: "action", label: "Reset choices" },
} satisfies DialConfig;

const compares = ["choices", "v1", "v2"] as const;

const decisionsPanel = "nyte-lab-token-choice-decisions-v1";

const styles = create({
  frame: { position: "fixed", inset: 0, width: "100%", height: "100%", borderWidth: 0 },
});

export function App() {
  const [loads, setLoads] = useState(0);
  const [measured, setMeasured] = useState<ReadonlyMap<string, Measured>>(new Map());
  const frame = useRef<HTMLIFrameElement>(null);
  const applied = useRef<string[]>([]);

  const preview = useDialKitController("Token choice", previewConfig, {
    id: "nyte-lab-token-choice-preview-v1",
    persist: true,
    onAction: (action) => {
      if (action === "copyCss")
        void navigator.clipboard.writeText(exportCss(choicesFrom(picked.getValues())));

      if (action === "reset") picked.resetValues();
    },
  });

  const decided = Object.entries(DialStore.getValues(decisionsPanel)).filter(
    ([path, value]) => path.endsWith(".pick") && value !== "undecided",
  ).length;

  const picked = useDialKitController(
    `Decisions · ${String(decided)}/${String(decisions.length)}`,
    decisionConfig(measured),
    {
      id: decisionsPanel,
      persist: true,
    },
  );

  const { appearance, sidebar, guides } = preview.values;
  const compare: Compare = compares.find((value) => value === preview.values.compare) ?? "choices";
  const surface = auditSurface(preview.values.surface);
  const workbench = workbenchState(preview.values.workbench);

  // Measure v1 against the bare desktop tokens, then lay the overrides back on.
  useLayoutEffect(() => {
    const document = frame.current?.contentDocument;

    if (loads === 0 || document == null) return;
    const root = document.documentElement;

    const sync = () => {
      root.dataset.theme = appearance;
      root.dataset.appearance = appearance;
      root.dataset.labSurface = surface;
      root.dataset.labWorkbench = workbench;
      root.dataset.labSidebar = String(sidebar);
      root.dataset.labSidebarReveal = sidebar ? "1" : "0";
      root.dataset.labColumns = String(guides);
      root.dataset.labRows = String(guides);
      const choices = choicesFrom(picked.values);
      applied.current = applyOverrides(root, new Map(), applied.current);
      const next = new Map<string, Measured>();

      for (const decision of decisions) next.set(decision.id, measure(document, decision));
      applied.current = applyOverrides(root, resolveOverrides(choices, compare), applied.current);
      applyPreviewCss(document, resolvePreviewCss(choices, compare));
      setMeasured(next);
    };

    sync();
  }, [loads, appearance, picked.values, compare, surface, workbench, sidebar, guides]);

  return (
    <>
      <iframe
        ref={frame}
        title="Desktop fixture"
        src="./demo.html"
        onLoad={() => setLoads((count) => count + 1)}
        {...props(styles.frame)}
      />
      <DialRoot theme="dark" defaultOpen productionEnabled />
    </>
  );
}
