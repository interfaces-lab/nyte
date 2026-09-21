import { create, props } from "@stylexjs/stylex";
import { DialRoot, useDialKitController } from "dialkit";
import "dialkit/styles.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page } from "./shell/chrome";
import { TokenDials } from "./shell/token-dials";
import { appearanceOf, backdropOf, previewConfig, tokenSetOf } from "./shell/preview-controls";
import { auditSurface, workbenchState } from "./shell/audit-state";

const styles = create({
  frame: { width: "100%", height: "100%", display: "block", borderWidth: 0, borderStyle: "none" },
});

export function App() {
  const [preview, setPreview] = useState<Document | null>(null);
  const controls = useDialKitController("Preview", previewConfig, {
    id: "nyte-lab-preview-v2",
    persist: true,
  });
  const { sidebar, guides } = controls.values;
  const setPreviewValues = controls.setValues;
  const appearance = appearanceOf(controls.values.appearance);
  const tokens = tokenSetOf(controls.values.tokens);
  const backdrop = backdropOf(controls.values.backdrop);
  const surface = auditSurface(controls.values.surface);
  const workbench = workbenchState(controls.values.workbench);
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
    if (root.dataset.labWorkbench !== workbench) root.dataset.labWorkbench = workbench;
    /*
     * A context menu has no open state the fixture can be told to adopt; it is
     * opened by a right click on a row. Asking for one sends the click and lets
     * the menu report the surface back, which is the same path a person takes.
     */
    if (root.dataset.labSurface === surface) return;
    const target =
      surface === "context" ? preview?.querySelector("[data-demo-context-target]") : null;
    if (target == null) {
      root.dataset.labSurface = surface;
      return;
    }
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
  }, [preview, appearance, tokens, sidebar, guides, reveal, surface, workbench]);

  useLayoutEffect(() => {
    if (preview === null) return;
    const root = preview.documentElement;
    const observer = new MutationObserver(() => {
      setPreviewValues({
        surface: auditSurface(root.dataset.labSurface),
        workbench: workbenchState(root.dataset.labWorkbench),
        tokens: tokenSetOf(root.dataset.labTokens ?? ""),
        sidebar: { expanded: root.dataset.labSidebar !== "false", scrub: { enabled: false } },
      });
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "data-lab-surface",
        "data-lab-sidebar",
        "data-lab-tokens",
        "data-lab-workbench",
      ],
    });
    return () => observer.disconnect();
  }, [preview, setPreviewValues]);

  useEffect(() => {
    const switchSet = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === "Digit1" || event.code === "Digit2") {
        event.preventDefault();
        setPreviewValues({ tokens: event.code === "Digit1" ? "nyte" : "calendar" });
      }
    };
    document.addEventListener("keydown", switchSet);
    return () => document.removeEventListener("keydown", switchSet);
  }, [setPreviewValues]);

  return (
    <>
      <Page backdrop={backdrop}>
        <iframe
          ref={iframe}
          title="Desktop audit fixture"
          src="./demo.html"
          {...props(styles.frame)}
          onLoad={(event) => {
            const document = event.currentTarget.contentDocument;
            if (document !== null) setPreview(document);
          }}
        />
      </Page>
      {preview !== null && (
        <TokenDials
          key={appearance}
          preview={preview}
          active={tokens}
          onActive={(set) => setPreviewValues({ tokens: set })}
          appearance={appearance}
        />
      )}
      <DialRoot theme="dark" defaultOpen productionEnabled />
    </>
  );
}
