import { Button } from "@nyte-ai/ui/button";
import { ContextMenuItem } from "@nyte-ai/ui/context-menu";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { props } from "@stylexjs/stylex";
import { motion } from "motion/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";
import { SessionPreviewCard } from "./sidebar-session-preview.tsx";

const titles = [
  "fix touch area! in that area",
  "Hardcoded workspace",
  "Investigate storage",
  "Subagent model",
];

function Rows() {
  return (
    <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 2, padding: 20 }}>
      {titles.map((title) => (
        <SessionPreviewCard
          key={title}
          title={title}
          context={{
            kind: "workspace",
            path: "/Users/x/nyte",
            repository: { owner: "o", name: "n" },
          }}
          trigger={
            <Row
              render={<motion.div layout={false} initial={false} />}
              revealActions
              xstyle={[styles.rowSurface, styles.sessionRow, title.startsWith("fix") && styles.sessionRowAsk]}
              data-row={title}
            >
              <Row.Primary xstyle={styles.rowPrimary}>
                {title.startsWith("fix") ? (
                  <Row.Body>
                    <span {...props(styles.sessionTitleLine)}>
                      <Row.Label xstyle={styles.sessionLabel}>{title}</Row.Label>
                      <Row.Meta xstyle={styles.rowMeta}>23h</Row.Meta>
                    </span>
                    <Row.Description xstyle={styles.sessionAsk}>Cannot find module '/Users/x'</Row.Description>
                  </Row.Body>
                ) : (
                  <>
                    <Row.Label xstyle={styles.sessionLabel}>{title}</Row.Label>
                    <Row.Meta xstyle={styles.rowMeta}>23h</Row.Meta>
                  </>
                )}
              </Row.Primary>
              <Row.Actions
                placement="overlay"
                xstyle={[styles.rowActions, styles.rowActionsBesideMeta, title.startsWith("fix") && styles.rowActionsAsk]}
              >
                <Button size="2xs" iconOnly icon="pin" aria-label="Pin" />
                <Button size="2xs" iconOnly aria-label="Archive" data-archive={title}>
                  <span {...props(styles.actionGlyphArchive)}>
                    <Icon name="archive" size={12} />
                  </span>
                </Button>
              </Row.Actions>
            </Row>
          }
          contextMenu={<ContextMenuItem onSelect={() => {}}>Pin</ContextMenuItem>}
        />
      ))}
    </div>
  );
}

export function run() {
  const container = document.createElement("div");
  document.body.append(container);
  flushSync(() => createRoot(container).render(<Rows />));
  const rect = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  Object.assign(window, {
    rect,
    popups: () =>
      [...document.querySelectorAll('[aria-label^="Details for"]')].map((element) => ({
        label: element.getAttribute("aria-label"),
        state: [...element.attributes]
          .filter((attribute) => attribute.name.startsWith("data-"))
          .map((attribute) => attribute.name)
          .join(","),
      })),
  });
  return "ready";
}
