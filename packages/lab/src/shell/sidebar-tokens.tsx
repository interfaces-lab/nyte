import { create, props } from "@stylexjs/stylex";
import { useLayoutEffect, useState } from "react";
import type { TokenSet } from "./chrome";
import { Icon } from "../../../desktop/src/renderer/src/components/icons.tsx";

const lengths = [
  ["--nyte-titlebar-height", "Titlebar height"],
  ["--nyte-sidebar-width", "Sidebar width"],
  ["--nyte-sidebar-row-height", "Sidebar row height"],
  ["--nyte-sidebar-row-gap", "Sidebar row gap"],
  ["--nyte-sidebar-row-padding-inline", "Sidebar row padding"],
  ["--nyte-sidebar-section-gap", "Sidebar section gap"],
  ["--nyte-conversation-measure", "Conversation width"],
  ["--nyte-conversation-gutter", "Conversation gutter"],
  ["--nyte-conversation-turn-gap", "Turn gap"],
  ["--nyte-prose-paragraph-gap", "Paragraph gap"],
  ["--nyte-workbench-rail-width", "Workbench width"],
  ["--nyte-workbench-row-height", "Workbench row height"],
  ["--nyte-workbench-row-gap", "Workbench row gap"],
  ["--nyte-workbench-row-padding-inline", "Workbench row padding"],
  ["--nyte-workbench-rail-gap", "Workbench section gap"],
  ["--nyte-font-size-base", "UI font size"],
  ["--nyte-font-size-lg", "Conversation font size"],
  ["--nyte-line-height-lg", "Conversation line height"],
  ["--nyte-radius-base", "Row radius"],
  ["--nyte-radius-xl", "Message / popover radius"],
  ["--nyte-dialog-width", "Dialog width"],
  ["--nyte-dialog-padding", "Dialog padding"],
  ["--nyte-dialog-gap", "Dialog gap"],
  ["--nyte-dialog-radius", "Dialog radius"],
  ["--nyte-suggestion-padding", "Popover padding"],
  ["--nyte-suggestion-item-height", "Popover row minimum"],
  ["--nyte-suggestion-item-gap", "Popover column gap"],
  ["--nyte-menu-width", "Menu width"],
  ["--nyte-menu-padding", "Menu padding"],
  ["--nyte-menu-radius", "Menu radius"],
  ["--nyte-menu-item-radius", "Menu row radius"],
  ["--nyte-menu-item-height", "Menu row minimum"],
  ["--nyte-menu-item-gap", "Menu column gap"],
  ["--nyte-menu-item-padding-inline", "Menu row inline padding"],
  ["--nyte-menu-item-padding-block", "Menu row block padding"],
] as const;
const colors = [
  ["--nyte-chrome-base", "Window color"],
  ["--nyte-editor-base", "Editor color"],
  ["--nyte-bg-raised", "Raised surface color"],
  ["--lab-window-backing", "Simulated window backing"],
  ["--nyte-sidebar-base", "Sidebar color"],
  ["--nyte-text-primary", "Primary text"],
  ["--nyte-text-secondary", "Secondary text"],
  ["--nyte-text-tertiary", "Tertiary text"],
  ["--nyte-icon-secondary", "Icons"],
  ["--nyte-stroke-secondary", "Borders"],
  ["--nyte-text-success", "Added lines"],
  ["--nyte-text-danger", "Removed lines"],
] as const;

const styles = create({
  panel: {
    position: "fixed",
    zIndex: 1100,
    insetBlockStart: 12,
    insetBlockEnd: 100,
    insetInlineEnd: 12,
    width: "min(440px, calc(100vw - 24px))",
    display: "flex",
    flexDirection: "column",
    borderRadius: 12,
    backgroundColor: "#18181b",
    color: "#fafafa",
    boxShadow: "0 16px 48px #0006, inset 0 0 0 1px #ffffff1f",
    font: "12px/18px system-ui, sans-serif",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 },
  title: { margin: 0, fontSize: 14, fontWeight: 500 },
  close: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    padding: 0,
    border: 0,
    borderRadius: 6,
    color: "inherit",
    backgroundColor: { default: "transparent", ":hover": "#ffffff14" },
    cursor: "pointer",
  },
  body: { overflowY: "auto", paddingInline: 16, paddingBlockEnd: 16, minHeight: 0 },
  note: { marginBlockStart: 0, marginBlockEnd: 16, color: "#a1a1aa" },
  field: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 100px",
    gap: 12,
    alignItems: "center",
    paddingBlock: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "#ffffff14",
  },
  colorField: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" },
  code: {
    display: "block",
    font: "10px/14px ui-monospace, monospace",
    overflowWrap: "anywhere",
    color: "#a1a1aa",
  },
  input: {
    width: "100%",
    padding: 6,
    border: "1px solid #ffffff26",
    borderRadius: 6,
    backgroundColor: "#ffffff08",
    color: "inherit",
    font: "inherit",
  },
  swatch: (color: string) => ({
    display: "inline-block",
    width: 12,
    height: 12,
    marginInlineEnd: 6,
    backgroundColor: color,
    borderRadius: 3,
    boxShadow: "inset 0 0 0 1px #ffffff26",
  }),
  reset: {
    marginBlockStart: 16,
    padding: "6px 10px",
    border: "1px solid #ffffff26",
    borderRadius: 6,
    backgroundColor: "#ffffff08",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
  },
  section: { fontSize: 13, fontWeight: 500, marginBlockStart: 20, marginBlockEnd: 4 },
});

function TokenField({
  name,
  label,
  kind,
  value,
  onChange,
}: {
  name: string;
  label: string;
  kind: "length" | "color";
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [previous, setPrevious] = useState(value);
  if (value !== previous) {
    setPrevious(value);
    setDraft(value);
  }
  const valid =
    kind === "length"
      ? draft !== "" &&
        Number.isFinite(Number(draft)) &&
        Number(draft) >= 0 &&
        Number(draft) <= 2000
      : CSS.supports("color", draft);
  return (
    <label {...props(styles.field, kind === "color" && styles.colorField)}>
      <span>
        {kind === "color" && <span {...props(styles.swatch(value))} />}
        {label}
        <code {...props(styles.code)}>{name}</code>
      </span>
      <input
        aria-label={label}
        aria-invalid={!valid}
        type={kind === "length" ? "number" : "text"}
        min={kind === "length" ? 0 : undefined}
        max={kind === "length" ? 2000 : undefined}
        step={kind === "length" ? "any" : undefined}
        value={draft}
        spellCheck={false}
        {...props(styles.input)}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          if (kind === "length") {
            const number = event.currentTarget.valueAsNumber;
            if (Number.isFinite(number) && number >= 0 && number <= 2000)
              onChange(name, `${number}px`);
          } else if (/^#[\da-f]{3,8}$/i.test(next) && CSS.supports("color", next))
            onChange(name, next);
        }}
        onBlur={() => setDraft(value)}
      />
    </label>
  );
}

export function SidebarTokens({
  revision,
  preview,
  tokenSet,
  onClose,
  onChange,
  onReset,
}: {
  revision: string;
  preview: Document | null;
  tokenSet: TokenSet;
  onClose: () => void;
  onChange: (name: string, value: string) => void;
  onReset: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const matches = ([name, label]: readonly [string, string]) =>
    `${name} ${label}`.toLowerCase().includes(query.toLowerCase());
  useLayoutEffect(() => {
    const view = preview?.defaultView;
    if (preview === null || view == null) return;
    const frame = requestAnimationFrame(() => {
      const current = view.getComputedStyle(preview.documentElement);
      const next: Record<string, string> = {};
      const probe = preview.createElement("i");
      probe.style.cssText =
        "position:absolute;visibility:hidden;pointer-events:none;display:block;height:0";
      preview.body.append(probe);
      for (const [name] of lengths) {
        probe.style.width = `var(${name})`;
        next[name] = String(parseFloat(view.getComputedStyle(probe).width));
      }
      probe.remove();
      for (const [name] of colors) next[name] = current.getPropertyValue(name).trim();
      setValues(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [revision, preview]);
  return (
    <aside aria-label="Token values" {...props(styles.panel)}>
      <div {...props(styles.header)}>
        <h2 {...props(styles.title)}>
          {tokenSet === "nyte" ? "A · Desktop" : "B · Calendar"} tokens
        </h2>
        <button
          type="button"
          aria-label="Close token values"
          onClick={onClose}
          {...props(styles.close)}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div {...props(styles.body)}>
        <p {...props(styles.note)}>
          Each set keeps its own edits. Alt+1 / Alt+2 switches sets without moving the pointer.
          Guides use one physical pixel and follow measured edges and text boxes. Native window
          controls and material are simulated; context menus here use the renderer implementation.
        </p>
        <input
          type="search"
          aria-label="Filter tokens"
          placeholder="Filter tokens"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          {...props(styles.input)}
        />
        <h3 {...props(styles.section)}>Geometry</h3>
        {lengths.filter(matches).map(([name, label]) => (
          <TokenField
            key={name}
            name={name}
            label={label}
            kind="length"
            value={values[name] ?? ""}
            onChange={onChange}
          />
        ))}
        <h3 {...props(styles.section)}>Colors · hex overrides</h3>
        {colors.filter(matches).map(([name, label]) => (
          <TokenField
            key={name}
            name={name}
            label={label}
            kind="color"
            value={values[name] ?? ""}
            onChange={onChange}
          />
        ))}
        <button type="button" onClick={onReset} {...props(styles.reset)}>
          Reset {tokenSet === "nyte" ? "A" : "B"} overrides
        </button>
      </div>
    </aside>
  );
}
