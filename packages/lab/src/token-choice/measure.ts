import type { Decision, DecisionKind } from "./decisions";

/**
 * Resolves CSS expressions inside the fixture document, where the desktop
 * tokens and the lab palette are both loaded. A probe element takes the
 * expression on the property that matches the decision's kind, so colours
 * come back as rgb(a) with their alpha intact and lengths come back in px.
 */
function resolve(document: Document, kind: DecisionKind, expression: string): string {
  const view = document.defaultView;

  if (view === null || expression === "") return "";
  const probe = document.createElement("i");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;display:block;height:0";
  document.body.append(probe);

  try {
    switch (kind) {
      case "color":
        probe.style.color = expression;

        return view.getComputedStyle(probe).color;
      case "length":
        probe.style.width = expression;

        return view.getComputedStyle(probe).width;
      case "shadow":
        probe.style.boxShadow = expression;

        return view.getComputedStyle(probe).boxShadow;
      case "font":
        probe.style.fontFamily = expression;

        return view.getComputedStyle(probe).fontFamily;
      case "code":
        return "";
    }
  } finally {
    probe.remove();
  }
}

export interface Measured {
  readonly v1: string;
  readonly v2: string;
}

/**
 * Called with every override removed, so `var(property)` reads the desktop
 * value the fixture falls back to: that is what "v1" means on this page.
 */
export function measure(document: Document, decision: Decision): Measured {
  const property = Object.keys(decision.set)[0];

  if (property === undefined) return { v1: "", v2: "" };

  return {
    v1: resolve(document, decision.kind, `var(${property})`),
    v2: resolve(document, decision.kind, decision.set[property] ?? ""),
  };
}

export function applyOverrides(
  root: HTMLElement,
  next: ReadonlyMap<string, string>,
  previous: readonly string[],
) {
  for (const property of previous) root.style.removeProperty(property);

  for (const [property, value] of next) root.style.setProperty(property, value);

  return [...next.keys()];
}

const previewStyleId = "token-choice-preview";

export function applyPreviewCss(document: Document, css: string) {
  const existing = document.getElementById(previewStyleId);

  if (css === "") {
    existing?.remove();

    return;
  }

  const style = existing ?? document.createElement("style");
  style.id = previewStyleId;
  style.textContent = css;

  if (existing === null) document.head.append(style);
}
