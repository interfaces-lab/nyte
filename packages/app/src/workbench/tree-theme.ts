import { create, props } from "@stylexjs/stylex";
import { target } from "@nyte-ai/ui/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useLayoutEffect, useState } from "react";
import { workbenchStyles } from "./workbench.stylex.ts";

const styles = create({ status: { color: role.contentSecondary } });

/** Row height at the current UI size. A tree reads it once, so its owner keys the tree on the size. */
export function treeItemHeight(): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position: absolute; visibility: hidden; height: max(${target.min}, ${type.leadingSm} + 8px)`;
  document.body.append(probe);

  const height = Math.ceil(probe.getBoundingClientRect().height);
  probe.remove();

  return height;
}

export function useTreeStatusTheme() {
  const [colors, setColors] = useState({
    added: role.contentSecondary,
    modified: role.contentSecondary,
    deleted: role.contentSecondary,
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    const probe = document.createElement("span");
    probe.hidden = true;
    root.append(probe);

    const color = (scope: Tint): string => {
      probe.className = props(surfaceTheme[scope], styles.status).className ?? "";

      return getComputedStyle(probe).color;
    };

    const update = (): void => {
      const next = {
        added: color("green"),
        modified: color("yellow"),
        deleted: color("red"),
      };

      setColors((current) =>
        current.added === next.added &&
        current.modified === next.modified &&
        current.deleted === next.deleted
          ? current
          : next,
      );
    };

    update();
    const appearance = new MutationObserver(update);
    appearance.observe(root, {
      attributes: true,
      attributeFilter: ["style", "class", "data-display-mode"],
    });

    return () => {
      appearance.disconnect();
      probe.remove();
    };
  }, []);

  return workbenchStyles.treeStatus(colors.added, colors.modified, colors.deleted);
}
