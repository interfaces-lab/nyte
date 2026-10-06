import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { WindowTabStrip } from "./window-tab-strip.tsx";
import type { WindowTabItem, WindowTabStripProps } from "./window-tab-strip.tsx";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function drag(from: Element, distance: number): Promise<void> {
  const rect = from.getBoundingClientRect();
  const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const pointer = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, button: 0 };

  from.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...point, buttons: 1 }));

  for (let moved = 10; moved <= Math.abs(distance); moved += 10) {
    await nextFrame();
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        ...pointer,
        ...point,
        clientX: point.clientX + Math.sign(distance) * moved,
        buttons: 1,
      }),
    );
  }

  await nextFrame();
  document.dispatchEvent(
    new PointerEvent("pointerup", { ...pointer, ...point, clientX: point.clientX + distance }),
  );
  await nextFrame();
}

function tab(id: string, title: string): WindowTabItem {
  return { id, title, tooltip: title, glyph: undefined, unread: false, split: undefined };
}

export async function run(): Promise<string> {
  const calls: string[] = [];
  const container = document.createElement("div");
  container.style.width = "800px";
  container.style.height = "40px";
  container.style.display = "flex";
  document.body.append(container);
  const root = createRoot(container);

  const render = (tabs: readonly WindowTabItem[]): void => {
    const strip: WindowTabStripProps = {
      tabs,
      activeTabId: tabs[0]?.id ?? "",
      mac: true,
      onActivate: (id) => calls.push(`activate ${id}`),
      onClose: (id) => calls.push(`close ${id}`),
      onNewTab: () => calls.push("new"),
      onReorder: (ids) => calls.push(`reorder ${ids.join(",")}`),
      onDuplicate: (id) => calls.push(`duplicate ${id}`),
      onCloseOthers: (id) => calls.push(`close-others ${id}`),
      onCloseToRight: (id) => calls.push(`close-right ${id}`),
    };

    flushSync(() => root.render(<WindowTabStrip {...strip} />));
  };

  try {
    render([tab("only", "Only")]);
    const only = container.querySelector('[role="tab"]');
    const label = only?.querySelector("span:not(:empty)");

    if (only === null || label === null || label === undefined) throw new Error("Missing tab");
    const outer = only.parentElement?.getBoundingClientRect();
    const inner = label.getBoundingClientRect();

    if (outer === undefined) throw new Error("Missing tab surface");
    check(container.querySelector('[aria-label="Close tab"]') === null, "The only tab can close");
    check(
      Math.abs(inner.left - outer.left - (outer.right - inner.right)) < 1,
      "A tab without a close button pads its label unevenly",
    );

    render([tab("first", "First"), tab("a", "Alpha"), tab("b", "Beta")]);
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const [first, alpha, beta] = tabs;

    if (first === undefined || alpha === undefined || beta === undefined)
      throw new Error("Missing tabs");
    check(first.getAttribute("aria-selected") === "true", "The active tab is not selected");

    await drag(beta, -600);
    check(calls.includes("activate b"), "Picking a tab up did not select it");
    check(calls.includes("reorder b,first,a"), `A tab did not move: ${calls.join("; ")}`);

    alpha.parentElement?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    check(calls.includes("close a"), "Middle-click did not close the tab");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
