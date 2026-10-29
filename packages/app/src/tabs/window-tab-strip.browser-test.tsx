import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { WindowTabStrip } from "./window-tab-strip.tsx";
import type { WindowTabItem, WindowTabStripProps } from "./window-tab-strip.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
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

function tab(id: string, title: string, preview = false): WindowTabItem {
  return {
    id,
    title,
    tooltip: title,
    sessions: [],
    glyph: undefined,
    unread: false,
    preview,
    split: undefined,
  };
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
      onClose: (id) => {
        calls.push(`close ${id}`);
        root.render(<WindowTabStrip {...strip} tabs={tabs.filter((item) => item.id !== id)} />);
      },
      onKeep: (id) => calls.push(`keep ${id}`),
      onNewTab: () => calls.push("new"),
      onReorder: (ids, id) => calls.push(`reorder ${ids.join(",")} moving ${id}`),
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
    check(calls.includes("reorder b,first,a moving b"), `A tab did not move: ${calls.join("; ")}`);

    alpha.parentElement?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    check(calls.includes("close a"), "Middle-click did not close the tab");

    render([tab("first", "First"), tab("a", "Alpha"), tab("b", "Beta")]);
    const focused = container.querySelectorAll<HTMLElement>('[role="tab"]')[1];
    focused?.focus();
    focused?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }));
    check(calls.at(-1) === "close a", `Delete did not close the focused tab: ${calls.join("; ")}`);
    check(
      document.activeElement?.getAttribute("aria-selected") === "true",
      "Focus did not return to the selected tab",
    );

    render([tab("first", "First"), tab("p", "Previewed", true)]);
    const [lasting, preview] = container.querySelectorAll('[role="tab"]');

    const titleStyle = (item: Element | undefined): string | undefined => {
      const title = item?.querySelector("span:not(:empty)");

      return title === null || title === undefined ? undefined : getComputedStyle(title).fontStyle;
    };

    if (preview === undefined) throw new Error("Missing preview tab");
    check(
      preview.getAttribute("aria-label") === "Previewed, preview",
      "A preview does not say so in its name",
    );
    check(titleStyle(preview) === "italic", "A preview title is upright");
    check(titleStyle(lasting) === "normal", "A lasting tab's title is italic");
    preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    check(calls.at(-1) === "keep p", "Double-click did not keep the preview");

    render([tab("short", "A"), tab("long", "A long title ".repeat(10))]);

    const [short, long] = [...container.querySelectorAll('[role="tab"]')].map(
      (item) => item.parentElement?.parentElement?.getBoundingClientRect().width ?? 0,
    );

    if (short === undefined || long === undefined) throw new Error("Missing sized tabs");
    check(short >= 72 && short < 120, `A short title's tab is ${String(short)} px wide`);
    check(long === 280, `A long title's tab is ${String(long)} px wide`);

    const scroller = container.querySelector('[role="tablist"] > [role="presentation"]');

    if (scroller === null) throw new Error("Missing strip scroller");
    check(getComputedStyle(scroller).maskImage === "none", "A strip that fits fades its edges");

    render(
      Array.from({ length: 16 }, (_, index) => tab(String(index), "A long title ".repeat(10))),
    );

    const fades = async (scrollLeft: number): Promise<string> => {
      scroller.scrollLeft = scrollLeft;
      await nextFrame();
      await nextFrame();

      return getComputedStyle(scroller).maskImage;
    };

    const opaque = (start: string, end: string): string =>
      `rgb(0, 0, 0) ${start}, rgb(0, 0, 0) ${end}`;

    const end = scroller.scrollWidth - scroller.clientWidth;
    check(
      (await fades(0)).includes(opaque("0px", "calc(100% - 8px)")),
      "Before a scroll, the end alone should fade",
    );
    check(
      (await fades(end / 2)).includes(opaque("8px", "calc(100% - 8px)")),
      "Midway, both edges should fade",
    );
    check(
      (await fades(end)).includes(opaque("8px", "100%")),
      "At the end, the start alone should fade",
    );

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
