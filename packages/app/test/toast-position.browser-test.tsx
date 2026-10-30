import { Toaster } from "@nyte-ai/ui/toast";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** The viewport's offsets from the window's bottom-end corner, and its width. */
function place(viewport: Element) {
  const box = viewport.getBoundingClientRect();

  return {
    end: innerWidth - box.right,
    bottom: innerHeight - box.bottom,
    width: box.width,
  };
}

/** Drops what a browser without anchor positioning ignores: anchor declarations and `@supports` blocks for them. */
function dropAnchorPositioning(container: CSSStyleSheet | CSSGroupingRule): void {
  const rules = [...container.cssRules];

  rules.toReversed().forEach((rule, reversed) => {
    if (rule instanceof CSSSupportsRule && rule.conditionText.includes("anchor")) {
      container.deleteRule(rules.length - 1 - reversed);

      return;
    }

    if (rule instanceof CSSStyleRule)
      [...rule.style]
        .filter((name) => `${name}:${rule.style.getPropertyValue(name)}`.includes("anchor"))
        .forEach((name) => rule.style.removeProperty(name));

    if (rule instanceof CSSGroupingRule) dropAnchorPositioning(rule);
  });
}

export function run() {
  const anchor = document.createElement("div");
  anchor.style.cssText =
    "position: fixed; left: 100px; top: 300px; width: 200px; height: 40px; anchor-name: --nyte-toast-anchor";
  const host = document.createElement("div");
  document.body.append(anchor, host);
  const root = createRoot(host);
  flushSync(() => root.render(<Toaster />));
  const viewport = document.querySelector('[data-slot="toast-viewport"]');

  if (viewport === null) throw new Error("Missing toast viewport");
  const actual = { anchored: place(viewport), plain: place(viewport) };
  [...document.styleSheets].forEach(dropAnchorPositioning);
  actual.plain = place(viewport);
  flushSync(() => root.unmount());
  host.remove();
  anchor.remove();

  const expected = {
    anchored: { end: innerWidth - 300, bottom: innerHeight - 292, width: 200 },
    plain: { end: 16, bottom: 16, width: 380 },
  };

  return JSON.stringify(actual) === JSON.stringify(expected)
    ? "passed"
    : `${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}
