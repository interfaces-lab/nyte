import { FileTree } from "@pierre/trees/react";
import type { FileTreeProps } from "@pierre/trees/react";
import { useMountEffect } from "../use-mount-effect.ts";
import type { ReactElement } from "react";

export function WorkspaceFileTree(properties: FileTreeProps): ReactElement {
  const { model } = properties;

  useMountEffect(() => {
    let observer: MutationObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const root = model.getFileTreeContainer()?.shadowRoot;
      if (root === null || root === undefined) return;

      const labelMenu = (): void => {
        const trigger = root.querySelector('[data-type="context-menu-trigger"]');
        if (!(trigger instanceof HTMLButtonElement)) return;
        const center =
          trigger.getBoundingClientRect().top + trigger.getBoundingClientRect().height / 2;
        const row = Array.from(root.querySelectorAll('[data-type="item"]')).find((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.height > 0 && bounds.top <= center && bounds.bottom > center;
        });
        if (!(row instanceof HTMLElement) || row.dataset.itemPath === undefined) return;
        trigger.setAttribute("aria-label", `Options for ${row.dataset.itemPath}`);
      };

      observer = new MutationObserver(labelMenu);
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style", "data-visible", "data-item-path"],
      });
      labelMenu();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  });

  return <FileTree {...properties} />;
}
