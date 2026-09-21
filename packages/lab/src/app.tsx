import { create, props } from "@stylexjs/stylex";
import { useDialKitController } from "dialkit";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page, Strip } from "./shell/chrome";
import type { Appearance, BackdropKind, TokenSet } from "./shell/chrome";
import { TokenDials } from "./shell/token-dials";
import { readTokenBaselines } from "./shell/token-catalog";
import type { TokenBaselines } from "./shell/token-catalog";
import { previewConfig } from "./shell/preview-controls";
import { auditSurface } from "./shell/audit-state";
import type { AuditSurface } from "./shell/audit-state";

const styles = create({
  frame: { width: "100%", height: "100%", display: "block", borderWidth: 0, borderStyle: "none" },
});

export function App() {
  const [appearance, setAppearance] = useState<Appearance>("dark");
  const [tokens, setTokens] = useState<TokenSet>("nyte");
  const [backdrop, setBackdrop] = useState<BackdropKind>("flat");
  const [surface, setSurface] = useState<AuditSurface>("none");
  const [panelOpen, setPanelOpen] = useState(true);
  const [preview, setPreview] = useState<Document | null>(null);
  const [baselines, setBaselines] = useState<TokenBaselines | null>(null);
  const controls = useDialKitController("Preview", previewConfig, {
    id: "nyte-lab-preview-v1",
    persist: true,
  });
  const { sidebar, guides } = controls.values;
  const setPreviewValues = controls.setValues;
  const requestedReveal = sidebar.scrub.enabled
    ? sidebar.scrub.position / 100
    : sidebar.expanded
      ? 1
      : 0;
  const reveal = Number.isFinite(requestedReveal) ? Math.max(0, Math.min(1, requestedReveal)) : 1;
  const iframe = useRef<HTMLIFrameElement>(null);

  useLayoutEffect(() => {
    const root = iframe.current?.contentDocument?.documentElement;
    if (root == null) return;
    root.style.removeProperty("--nyte-sidebar-width");
    root.style.setProperty("--lab-sidebar-reveal", String(reveal));
    if (!sidebar.animate || sidebar.scrub.enabled)
      root.style.setProperty("--lab-sidebar-duration", "0ms");
    else if (sidebar.duration.override)
      root.style.setProperty("--lab-sidebar-duration", `${sidebar.duration.value}ms`);
    else root.style.removeProperty("--lab-sidebar-duration");
    if (sidebar.easing.override && CSS.supports("transition-timing-function", sidebar.easing.value))
      root.style.setProperty("--lab-sidebar-easing", sidebar.easing.value);
    else root.style.removeProperty("--lab-sidebar-easing");
    if (guides.opacity.override)
      root.style.setProperty("--lab-guide-opacity", String(guides.opacity.value));
    else root.style.removeProperty("--lab-guide-opacity");
    if (guides.color.override && CSS.supports("color", guides.color.value))
      root.style.setProperty("--lab-guide-color", guides.color.value);
    else root.style.removeProperty("--lab-guide-color");
    root.dataset.theme = appearance;
    root.dataset.appearance = appearance;
    root.dataset.labTokens = tokens;
    if (root.dataset.labSidebar !== String(sidebar.expanded))
      root.dataset.labSidebar = String(sidebar.expanded);
    root.dataset.labSidebarReveal = String(reveal);
    root.dataset.labColumns = String(guides.columns);
    root.dataset.labRows = String(guides.rows);
    if (root.dataset.labSurface !== surface) root.dataset.labSurface = surface;
  }, [preview, appearance, tokens, sidebar, guides, reveal, surface]);

  useLayoutEffect(() => {
    if (preview === null) return;
    const root = preview.documentElement;
    const observer = new MutationObserver((records) => {
      setSurface(auditSurface(root.dataset.labSurface));
      setTokens(root.dataset.labTokens === "calendar" ? "calendar" : "nyte");
      if (records.some((record) => record.attributeName === "data-lab-sidebar")) {
        setPreviewValues({
          sidebar: { expanded: root.dataset.labSidebar !== "false", scrub: { enabled: false } },
        });
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-lab-surface", "data-lab-sidebar", "data-lab-tokens"],
    });
    return () => observer.disconnect();
  }, [preview, setPreviewValues]);

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
            const document = event.currentTarget.contentDocument;
            if (document !== null) {
              setBaselines(readTokenBaselines(document, appearance));
              setPreview(document);
            }
          }}
        />
      </Page>
      <Strip
        appearance={appearance}
        tokens={tokens}
        backdrop={backdrop}
        sidebarVisible={reveal > 0}
        columns={guides.columns}
        rows={guides.rows}
        tokensOpen={panelOpen}
        surface={surface}
        onSurface={showSurface}
        onTokenSet={setTokens}
        onBackdrop={setBackdrop}
        onAppearance={(value) => {
          if (preview !== null) setBaselines(readTokenBaselines(preview, value));
          setAppearance(value);
        }}
        onSidebar={() =>
          setPreviewValues({ sidebar: { expanded: reveal === 0, scrub: { enabled: false } } })
        }
        onColumns={() => setPreviewValues({ guides: { columns: !guides.columns } })}
        onRows={() => setPreviewValues({ guides: { rows: !guides.rows } })}
        onTokens={() => setPanelOpen(!panelOpen)}
      />
      {preview !== null && baselines !== null && (
        <TokenDials
          key={appearance}
          preview={preview}
          baselines={baselines}
          active={tokens}
          onActive={setTokens}
          appearance={appearance}
          open={panelOpen}
        />
      )}
    </>
  );
}
