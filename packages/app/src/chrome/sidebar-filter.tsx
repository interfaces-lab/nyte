import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { useId } from "react";
import { props } from "@stylexjs/stylex";
import { Icon } from "@nyte-ai/ui/icon";
import type { ReactElement } from "react";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import type { IconName } from "@nyte-ai/ui/icon";
import { StatusDot } from "../components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Toggle } from "@nyte-ai/ui/toggle";
import { sidebarFilterStyles as styles } from "./sidebar-filter.stylex.ts";
import {
  clearSessionFilters,
  ENVIRONMENTS,
  GROUPINGS,
  hasSessionFilters,
  isOption,
  ORDERINGS,
  PULL_REQUESTS,
  SHOW_FIELDS,
  SOURCES,
  STATUSES,
  toggleOption,
  type SessionPullRequest,
  type SessionEnvironment,
  type SessionShowField,
  type SessionSource,
  type SessionStatus,
  type SessionViewSettings,
} from "./sidebar-view.ts";

const SHOW_FIELD_ICONS = {
  updated: "clock",
  environment: "globe",
  pr: "pull-request",
  branch: "git-branch",
  machine: "devices",
} as const satisfies Readonly<Record<SessionShowField, IconName>>;

const STATUS_LABELS = {
  "needs-attention": "Needs Attention",
  unread: "Unread",
  working: "Working",
  draft: "Draft",
  done: "Done",
} as const satisfies Readonly<Record<SessionStatus, string>>;

const PR_LABELS = {
  draft: "Draft",
  open: "Open",
  merged: "Merged",
  closed: "Closed",
  none: "No PR",
} as const satisfies Readonly<Record<SessionPullRequest, string>>;

const PR_ICONS = {
  draft: "draft",
  open: "pull-request",
  merged: "merged",
  closed: "pull-request-closed",
  none: "circle-x",
} as const satisfies Readonly<Record<SessionPullRequest, IconName>>;

const ENVIRONMENT_ICONS = {
  cloud: "cloud",
  local: "computer",
} as const satisfies Readonly<Record<SessionEnvironment, IconName>>;

const SOURCE_LABELS = {
  desktop: "Desktop",
  mobile: "Mobile",
  web: "Web",
  cli: "CLI",
  setup: "Setup",
  slack: "Slack",
  linear: "Linear",
  "source-control": "Source Control",
  "grok-bot": "Grok Bot",
  sdk: "SDK",
  api: "API",
  automations: "Automations",
  bugbot: "Bugbot",
  "frontend-qa": "Frontend QA",
} as const satisfies Readonly<Record<SessionSource, string>>;

const SOURCE_ICONS = {
  desktop: "window-app",
  mobile: "phone",
  web: "website",
  cli: "console",
  setup: "settings",
  slack: "slack",
  linear: "linear",
  "source-control": "git",
  "grok-bot": "grok",
  sdk: "code-brackets",
  api: "cloud-api",
  automations: "robot",
  bugbot: "bug",
  "frontend-qa": "test-tube",
} as const satisfies Readonly<Record<SessionSource, IconName>>;

function statusIcon(status: SessionStatus): IconName | undefined {
  switch (status) {
    case "needs-attention":
      return "bell";
    case "unread":
      return "inbox-empty";
    case "draft":
      return "draft";
    case "working":
    case "done":
      return undefined;
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

interface WorkspaceControlsProps {
  readonly value: SessionViewSettings;
  readonly filterDisabled: boolean;
  readonly homeVisible: boolean;
  readonly onHomeVisibleChange: (visible: boolean) => void;
  readonly onChange: (value: SessionViewSettings) => void;
  readonly onOpenFolder: (() => void) | undefined;
  readonly onCollapseAll: () => void;
}

export function WorkspaceControls({
  value,
  filterDisabled,
  homeVisible,
  onHomeVisibleChange,
  onChange,
  onOpenFolder,
  onCollapseAll,
}: WorkspaceControlsProps): ReactElement {
  const filtersActive = hasSessionFilters(value);
  const loadingReasonId = useId();

  const resetFilters = (): void => {
    onChange(clearSessionFilters(value));
  };

  return (
    <span {...props(styles.controls)}>
      <Menu
        onOpenChange={(open, details) => {
          if (open && filterDisabled) details.cancel();
        }}
      >
        <MenuTrigger
          render={
            <Toggle
              size="sm"
              iconOnly
              aria-disabled={filterDisabled || undefined}
              aria-describedby={filterDisabled ? loadingReasonId : undefined}
              aria-label="Customize sidebar"
              pressed={filtersActive}
              onPressedChange={() => undefined}
            >
              <Icon name="filters" size={14} />
            </Toggle>
          }
        />
        <MenuContent side="right" align="start" xstyle={styles.popup}>
          <MenuSub>
            <MenuSubTrigger icon="folder">Grouping</MenuSubTrigger>
            <MenuSubContent xstyle={styles.popup}>
              <MenuRadioGroup
                value={value.grouping}
                onValueChange={(grouping) => {
                  if (isOption(grouping, GROUPINGS)) onChange({ ...value, grouping });
                }}
              >
                <MenuRadioItem value="none" icon="list" closeOnClick={false}>
                  None
                </MenuRadioItem>
                <MenuRadioItem value="repository" icon="github" closeOnClick={false}>
                  Repository
                </MenuRadioItem>
                <MenuRadioItem value="workspace" icon="folder" closeOnClick={false}>
                  Workspace
                </MenuRadioItem>
                <MenuRadioItem value="updated" icon="clock" closeOnClick={false}>
                  Updated
                </MenuRadioItem>
                <MenuRadioItem value="status" icon="square" closeOnClick={false}>
                  Status
                </MenuRadioItem>
                <MenuRadioItem value="environment" icon="globe" closeOnClick={false}>
                  Environment
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuSubContent>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger icon="clock">Ordering</MenuSubTrigger>
            <MenuSubContent xstyle={styles.popup}>
              <MenuRadioGroup
                value={value.ordering}
                onValueChange={(ordering) => {
                  if (isOption(ordering, ORDERINGS)) onChange({ ...value, ordering });
                }}
              >
                <MenuRadioItem value="updated" icon="clock" closeOnClick={false}>
                  Updated
                </MenuRadioItem>
                <MenuRadioItem value="status" icon="square" closeOnClick={false}>
                  Status
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuSubContent>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger icon="eye">Show</MenuSubTrigger>
            <MenuSubContent xstyle={styles.popup}>
              <MenuCheckboxItem checked={homeVisible} onCheckedChange={onHomeVisibleChange}>
                Home
              </MenuCheckboxItem>
              <MenuSeparator />
              {SHOW_FIELDS.map((field) => (
                <MenuCheckboxItem
                  key={field}
                  icon={SHOW_FIELD_ICONS[field]}
                  checked={value.show.includes(field)}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      show: toggleOption(SHOW_FIELDS, value.show, field, checked),
                    })
                  }
                >
                  {field === "pr" ? "PR" : field[0]?.toLocaleUpperCase() + field.slice(1)}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuSeparator />
          <MenuGroup>
            <div {...props(styles.groupHeading)}>
              <MenuGroupLabel xstyle={styles.groupLabel}>Filters</MenuGroupLabel>
              {filtersActive && (
                <MenuItem
                  layout="plain"
                  closeOnClick={false}
                  xstyle={styles.groupAction}
                  onClick={resetFilters}
                >
                  Reset
                </MenuItem>
              )}
            </div>
            <MenuSub>
              <MenuSubTrigger icon="square">Status</MenuSubTrigger>
              <MenuSubContent xstyle={styles.popup}>
                {STATUSES.map((status) => (
                  <MenuCheckboxItem
                    key={status}
                    icon={statusIcon(status)}
                    checked={value.statuses.includes(status)}
                    leading={
                      status === "needs-attention" ? (
                        <StatusDot mark="waiting" />
                      ) : status === "working" ? (
                        <StatusDot mark="working" />
                      ) : undefined
                    }
                    onCheckedChange={(checked) =>
                      onChange({
                        ...value,
                        statuses: toggleOption(STATUSES, value.statuses, status, checked),
                      })
                    }
                  >
                    {STATUS_LABELS[status]}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
            <MenuSub>
              <MenuSubTrigger icon="pull-request">PR</MenuSubTrigger>
              <MenuSubContent xstyle={styles.popup}>
                {PULL_REQUESTS.map((pullRequest) => (
                  <MenuCheckboxItem
                    key={pullRequest}
                    icon={PR_ICONS[pullRequest]}
                    checked={value.pullRequests.includes(pullRequest)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...value,
                        pullRequests: toggleOption(
                          PULL_REQUESTS,
                          value.pullRequests,
                          pullRequest,
                          checked,
                        ),
                      })
                    }
                  >
                    {PR_LABELS[pullRequest]}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
            <MenuSub>
              <MenuSubTrigger icon="globe">Environment</MenuSubTrigger>
              <MenuSubContent xstyle={styles.popup}>
                {ENVIRONMENTS.map((environment) => (
                  <MenuCheckboxItem
                    key={environment}
                    icon={ENVIRONMENT_ICONS[environment]}
                    checked={value.environments.includes(environment)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...value,
                        environments: toggleOption(
                          ENVIRONMENTS,
                          value.environments,
                          environment,
                          checked,
                        ),
                      })
                    }
                  >
                    {environment === "cloud" ? "Cloud" : "Local"}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
            <MenuSub>
              <MenuSubTrigger icon="apps">Source</MenuSubTrigger>
              <MenuSubContent xstyle={styles.popup}>
                {SOURCES.map((source) => (
                  <MenuCheckboxItem
                    key={source}
                    icon={SOURCE_ICONS[source]}
                    checked={value.sources.includes(source)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...value,
                        sources: toggleOption(SOURCES, value.sources, source, checked),
                      })
                    }
                  >
                    {SOURCE_LABELS[source]}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
            <MenuCheckboxItem
              checked={value.archived}
              icon="archive"
              onCheckedChange={(archived) => onChange({ ...value, archived })}
            >
              Archived
            </MenuCheckboxItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuItem icon="folder" onClick={onCollapseAll}>
            Collapse All Workspaces
          </MenuItem>
        </MenuContent>
      </Menu>
      {filterDisabled && (
        <span id={loadingReasonId} {...props(srOnly)}>
          Chats are loading
        </span>
      )}
      {onOpenFolder !== undefined && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                iconOnly
                aria-label="Open folder"
                onClick={onOpenFolder}
                title={undefined}
              >
                <Icon name="folder-add" size={14} />
              </Button>
            }
          />
          <TooltipContent side="bottom" align="end">
            Open Workspace
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
