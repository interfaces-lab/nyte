import type { IconName } from "@nyte-ai/ui/icon";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import {
  WORKBENCH_KINDS,
  workbenchLaunchers,
  workbenchShowsChat,
  workbenchTabAvailable,
  workbenchTabLabel,
} from "./model.ts";
import type { LaunchKind, WorkbenchScope, WorkbenchTab, WorkbenchViewState } from "./model.ts";

export function visibleTabs(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): readonly WorkbenchTab[] {
  return view.tabs.filter(
    (tab) =>
      workbenchTabAvailable(scope, tab.kind, capabilities) &&
      (tab.kind !== "file" || tab.group === view.group),
  );
}

export function activeWorkbenchTab(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): WorkbenchTab | null {
  const tabs = visibleTabs(view, scope, capabilities);

  return tabs.find((tab) => tab.id === view.active) ?? tabs[0] ?? null;
}

export function shownWorkbenchTab(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): WorkbenchTab | null {
  if (!view.expanded || workbenchShowsChat(view.layout)) return null;

  return activeWorkbenchTab(view, scope, capabilities);
}

interface RailLauncher {
  readonly kind: LaunchKind;
  readonly label: string;
  readonly icon: IconName;
}

interface RailModel {
  readonly changes: boolean;
  readonly openTabs: readonly WorkbenchTab[];
  readonly launchers: readonly RailLauncher[];
}

export function railModel(input: {
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly capabilities: ClientCapabilities;
  readonly repository: boolean;
}): RailModel {
  const openTabs = visibleTabs(input.view, input.scope, input.capabilities);
  const launchers = workbenchLaunchers(input.scope, input.capabilities);
  const changes = input.repository && launchers.includes("changes");

  return {
    changes,
    openTabs,
    launchers: launchers.flatMap((kind): RailLauncher[] => {
      const descriptor = WORKBENCH_KINDS[kind];

      if (kind === "changes" && changes) return [];

      if (descriptor.launch.policy === "new")
        return [{ kind, label: `New ${descriptor.label}`, icon: descriptor.icon }];

      return openTabs.some((tab) => tab.kind === kind)
        ? []
        : [{ kind, label: descriptor.label, icon: descriptor.icon }];
    }),
  };
}

interface TabPresentation {
  readonly label: string;
  readonly title: string | undefined;
}

export function tabPresentation(
  tab: WorkbenchTab,
  file: { readonly displayPath: string } | undefined,
  terminal: { readonly title: string; readonly cwd: string } | undefined,
): TabPresentation {
  return {
    label: terminal?.title ?? workbenchTabLabel(tab),
    title: file?.displayPath ?? (terminal?.cwd === "" ? undefined : terminal?.cwd),
  };
}
