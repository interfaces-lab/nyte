import { create, props } from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page, Strip } from "./shell/chrome";
import type { Appearance, BackdropKind, TokenSet } from "./shell/chrome";
import { SidebarTokens } from "./shell/sidebar-tokens";
import { auditSurface } from "./shell/audit-state";
import type { AuditSurface } from "./shell/audit-state";

const styles = create({
  frame: { width: "100%", height: "100%", display: "block", borderWidth: 0, borderStyle: "none" },
});

export function App() {
  const [appearance, setAppearance] = useState<Appearance>("dark");
  const [tokens, setTokens] = useState<TokenSet>("nyte");
  const [backdrop, setBackdrop] = useState<BackdropKind>("flat");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [columns, setColumns] = useState(true);
  const [rows, setRows] = useState(true);
  const [surface, setSurface] = useState<AuditSurface>("none");
  const [panelOpen, setPanelOpen] = useState(false);
  const [preview, setPreview] = useState<Document | null>(null);
  const [sets, setSets] = useState<Record<TokenSet, Record<string, string>>>({
    nyte: {},
    calendar: {},
  });
  const applied = useRef<string[]>([]);
  const iframe = useRef<HTMLIFrameElement>(null);
  const overrides = sets[tokens];
  const revision = JSON.stringify({ appearance, tokens, overrides, sidebarVisible });

  useLayoutEffect(() => {
    const root = iframe.current?.contentDocument?.documentElement;
    if (root == null) return;
    for (const name of applied.current) if (!(name in overrides)) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(overrides)) root.style.setProperty(name, value);
    applied.current = Object.keys(overrides);
    root.dataset.theme = appearance;
    root.dataset.appearance = appearance;
    root.dataset.labTokens = tokens;
    root.dataset.labSidebar = String(sidebarVisible);
    root.dataset.labColumns = String(columns);
    root.dataset.labRows = String(rows);
    if (root.dataset.labSurface !== surface) root.dataset.labSurface = surface;
  }, [preview, appearance, tokens, overrides, sidebarVisible, columns, rows, surface]);

  useLayoutEffect(() => {
    if (preview === null) return;
    const root = preview.documentElement;
    const observer = new MutationObserver(() => {
      setSurface(auditSurface(root.dataset.labSurface));
      setTokens(root.dataset.labTokens === "calendar" ? "calendar" : "nyte");
      setSidebarVisible(root.dataset.labSidebar !== "false");
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-lab-surface", "data-lab-sidebar", "data-lab-tokens"],
    });
    return () => observer.disconnect();
  }, [preview]);

  useEffect(() => {
    const switchSet = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === "Digit1" || event.code === "Digit2") {
        event.preventDefault();
        setTokens(event.code === "Digit1" ? "nyte" : "calendar");
      }
    };
    document.addEventListener("keydown", switchSet);
    return () => document.removeEventListener("keydown", switchSet);
  }, []);

  const showSurface = (value: AuditSurface) => {
    if (value === "context" && preview !== null) {
      const target = preview.querySelector("[data-demo-context-target]");
      if (target !== null) {
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: rect.left + 100,
            clientY: rect.top + 12,
          }),
        );
        return;
      }
    }
    setSurface(value);
  };

  return (
    <>
      <Page backdrop={backdrop} inspecting={panelOpen}>
        <iframe
          ref={iframe}
          title="Desktop audit fixture"
          src="./demo.html"
          {...props(styles.frame)}
          onLoad={(event) => {
            applied.current = [];
            setPreview(event.currentTarget.contentDocument);
          }}
        />
      </Page>
      <Strip
        appearance={appearance}
        tokens={tokens}
        backdrop={backdrop}
        sidebarVisible={sidebarVisible}
        columns={columns}
        rows={rows}
        tokensOpen={panelOpen}
        surface={surface}
        onSurface={showSurface}
        onAppearance={setAppearance}
        onTokenSet={setTokens}
        onBackdrop={setBackdrop}
        onSidebar={() => setSidebarVisible(!sidebarVisible)}
        onColumns={() => setColumns(!columns)}
        onRows={() => setRows(!rows)}
        onTokens={() => setPanelOpen(!panelOpen)}
      />
      {panelOpen && (
        <SidebarTokens
          revision={revision}
          preview={preview}
          tokenSet={tokens}
          onClose={() => setPanelOpen(false)}
          onReset={() => setSets((current) => ({ ...current, [tokens]: {} }))}
          onChange={(name, value) =>
            setSets((current) => ({ ...current, [tokens]: { ...current[tokens], [name]: value } }))
          }
        />
      )}
    </>
  );
}
