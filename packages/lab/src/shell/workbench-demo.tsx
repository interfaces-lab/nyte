import { create, props } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { useState } from "react";
import { workbenchStyles } from "../../../desktop/src/renderer/src/workbench/workbench.stylex.ts";
import { ChangesSidebar } from "../../../desktop/src/renderer/src/workbench/changes-sidebar.tsx";
import type { ChangesSidebarFile } from "../../../desktop/src/renderer/src/workbench/changes-sidebar.tsx";
import { ChangesToolbar } from "../../../desktop/src/renderer/src/workbench/changes-toolbar.tsx";
import { defaultChangesViewOptions } from "../../../desktop/src/renderer/src/workbench/changes-view-options.ts";
import { Icon, PanelToggleIcon } from "../../../desktop/src/renderer/src/components/icons.tsx";
import type { IconName } from "../../../desktop/src/renderer/src/components/icons.tsx";
import { IconButton, focus } from "../../../desktop/src/renderer/src/components/ui.tsx";
import { workbench } from "../../../desktop/src/renderer/src/theme/schema.stylex.ts";
import { t } from "../../../desktop/src/renderer/src/theme/vars.stylex.ts";
import type { WorkbenchState } from "./audit-state";

const navigation = [
  { label: "Files", icon: "file" },
  { label: "Changes", icon: "git-branch" },
  { label: "Browser", icon: "globe" },
  { label: "Terminal", icon: "console" },
  { label: "Agents", icon: "robot" },
] satisfies { label: string; icon: IconName }[];

const files: ChangesSidebarFile[] = [
  {
    path: "packages/lab/src/tokens/shadow.css",
    status: "added",
    added: 31,
    removed: 0,
    viewed: "unviewed",
  },
  {
    path: "packages/lab/src/shell/token-catalog.ts",
    status: "modified",
    added: 78,
    removed: 22,
    viewed: "unviewed",
  },
  {
    path: "packages/lab/src/shell/token-dials.tsx",
    status: "modified",
    added: 24,
    removed: 11,
    viewed: "viewed",
  },
  {
    path: "packages/lab/src/shell/workbench-demo.tsx",
    status: "added",
    added: 16,
    removed: 2,
    viewed: "unviewed",
  },
];

/*
 * A stand-in for the diff viewer, which reads the appearance store and a code
 * model the fixture has no host for. The rows exist so the diff colours and
 * the diff line height have something to move; nothing else here is a claim
 * about the real stack.
 */
const patch = [
  { kind: "meta", text: "@@ -108,6 +108,14 @@ :root {" },
  { kind: "context", text: "  --nyte-shadow-primary: #00000033;" },
  { kind: "removed", text: "- --nyte-shadow-popover: 0 4px 16px var(--nyte-shadow-tertiary);" },
  { kind: "added", text: "+ --lab-shadow-depth: 1;" },
  { kind: "added", text: "+ --nyte-shadow-popover: 0 calc(4px * var(--lab-shadow-depth))" },
  { kind: "added", text: "+   calc(16px * var(--lab-shadow-depth)) var(--nyte-shadow-tertiary);" },
  { kind: "context", text: "  --nyte-shadow-modal: var(--nyte-box-shadow-lg);" },
] as const;

const fixture = create({
  header: {
    display: "flex",
    alignItems: "center",
    minHeight: workbench.headerHeight,
    flexShrink: 0,
  },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  stack: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    paddingBlock: 8,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
  },
  line: {
    display: "block",
    minHeight: "var(--nyte-diff-line-height)",
    paddingInline: 12,
    lineHeight: "var(--nyte-diff-line-height)",
    whiteSpace: "pre",
  },
  meta: { color: t.textTertiary },
  context: { color: t.textSecondary },
  added: { backgroundColor: t.diffAddedLineBg, color: t.textPrimary },
  removed: { backgroundColor: t.diffRemovedLineBg, color: t.textPrimary },
});

const lineStyles = {
  meta: fixture.meta,
  context: fixture.context,
  added: fixture.added,
  removed: fixture.removed,
} as const;

export function WorkbenchDemo({
  state,
  onState,
}: {
  state: WorkbenchState;
  onState: (state: WorkbenchState) => void;
}) {
  const [openTab, setOpenTab] = useState<string>();
  const [fileTree, setFileTree] = useState(true);
  const [activePath, setActivePath] = useState(files[1]?.path);

  if (state === "compact") {
    return (
      <div {...props(workbenchStyles.root)}>
        <section {...props(workbenchStyles.panel, workbenchStyles.railHostCompact)}>
          <nav aria-label="Workbench navigation" {...props(workbenchStyles.iconRail)}>
            <IconButton
              label="Expand workbench"
              onClick={() => onState("rail")}
              icon={
                <span {...props(workbenchStyles.doubleChevron, workbenchStyles.doubleChevronBack)}>
                  <Icon name="chevron-right" size={11} />
                  <span {...props(workbenchStyles.doubleChevronTrail)}>
                    <Icon name="chevron-right" size={11} />
                  </span>
                </span>
              }
            />
            <span aria-hidden="true" {...props(workbenchStyles.iconRailDivider)} />
            {navigation.map((item) => (
              <IconButton
                key={item.label}
                icon={item.icon}
                label={`Open ${item.label}`}
                onClick={() => onState("panel")}
              />
            ))}
          </nav>
        </section>
      </div>
    );
  }

  if (state === "panel") {
    return (
      <div {...props(workbenchStyles.root)}>
        <section {...props(workbenchStyles.panel, workbenchStyles.panelOpen)}>
          <div {...props(workbenchStyles.panelBody)}>
            <div
              role="separator"
              tabIndex={0}
              aria-label="Resize workbench"
              aria-orientation="vertical"
              {...props(workbenchStyles.sash)}
            />
            <div {...props(workbenchStyles.panelSlot)}>
              <div data-grid-row="workbench-header" {...props(fixture.header)}>
                <ChangesToolbar
                  scope={{ kind: "uncommitted" }}
                  scopeLabel="Uncommitted"
                  scopeStats={undefined}
                  scopeFileCount={files.length}
                  snapshot={undefined}
                  repository={undefined}
                  branch={undefined}
                  turnOptions={[]}
                  viewOptions={defaultChangesViewOptions}
                  fileTreeVisible={fileTree}
                  allFilesCollapsed={false}
                  onScopeChange={() => {}}
                  onViewOptionsChange={() => {}}
                  onToggleFileTree={() => setFileTree(!fileTree)}
                  onRefresh={() => {}}
                  onFilterFiles={() => {}}
                  onToggleCollapseAll={() => {}}
                />
              </div>
              <div {...props(fixture.body)}>
                <div data-grid-scroll="" {...props(fixture.stack)}>
                  {patch.map((line, index) => (
                    <span
                      key={index}
                      data-grid-row="diff"
                      {...props(fixture.line, lineStyles[line.kind])}
                    >
                      {line.text}
                    </span>
                  ))}
                </div>
                <ChangesSidebar
                  files={files}
                  visible={fileTree}
                  activePath={activePath}
                  onRevealPath={setActivePath}
                  onAllViewedChange={() => {}}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div {...props(workbenchStyles.root)}>
      <section {...props(workbenchStyles.panel, workbenchStyles.railHost)}>
        <nav aria-label="Workbench navigation" {...props(workbenchStyles.rail)}>
          <section {...props(workbenchStyles.railSection)}>
            <div data-grid-row="workbench-heading" {...props(workbenchStyles.railHeading)}>
              <span {...props(workbenchStyles.railHeadingText)}>Open Tabs</span>
              <Button
                unstyled
                aria-label="Collapse workbench"
                onClick={() => onState("compact")}
                {...props(workbenchStyles.chevron, focus.ring)}
              >
                <span {...props(workbenchStyles.doubleChevron)}>
                  <Icon name="chevron-right" size={11} />
                  <span {...props(workbenchStyles.doubleChevronTrail)}>
                    <Icon name="chevron-right" size={11} />
                  </span>
                </span>
              </Button>
            </div>
            {openTab !== undefined && (
              <Button
                unstyled
                onClick={() => setOpenTab(undefined)}
                {...props(workbenchStyles.railRow)}
              >
                <span {...props(workbenchStyles.railLabel)}>{openTab}</span>
                <Icon name="x" size={14} />
              </Button>
            )}
          </section>
          <section {...props(workbenchStyles.railSection)}>
            <div data-grid-row="workbench-heading" {...props(workbenchStyles.railHeading)}>
              <span {...props(workbenchStyles.railHeadingText)}>On nyte</span>
            </div>
            {navigation.map((item) => (
              <Button
                unstyled
                key={item.label}
                data-grid-row="workbench"
                onClick={() => {
                  setOpenTab(item.label);

                  if (item.label === "Changes") onState("panel");
                }}
                {...props(workbenchStyles.railRow, focus.ring)}
              >
                <span data-grid-column="workbench.icons" {...props(workbenchStyles.railIcon)}>
                  <Icon name={item.icon} size={14} />
                </span>
                <span
                  data-grid-text=""
                  data-grid-column="workbench.labels"
                  {...props(workbenchStyles.railLabel)}
                >
                  {item.label}
                </span>
                {item.label === "Changes" && (
                  <span {...props(workbenchStyles.railStats)}>
                    <span {...props(workbenchStyles.railAdded)}>+149</span>
                    <span {...props(workbenchStyles.railRemoved)}>-35</span>
                  </span>
                )}
              </Button>
            ))}
          </section>
        </nav>
      </section>
    </div>
  );
}

export function PanelToggle({
  state,
  onState,
}: {
  state: WorkbenchState;
  onState: (state: WorkbenchState) => void;
}) {
  return (
    <IconButton
      label="Toggle workbench"
      onClick={() => onState(state === "compact" ? "rail" : "compact")}
      icon={<PanelToggleIcon side="right" visible={state !== "compact"} />}
    />
  );
}
