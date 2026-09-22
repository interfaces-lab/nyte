import * as stylex from "@stylexjs/stylex";
import { IconFilter2, IconFolderAddRight } from "central-icons";
import type { ReactElement } from "react";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
} from "../components/menu.tsx";
import type { IconName } from "../components/icons.tsx";
import { focus, Hint, StatusDot } from "../components/ui.tsx";
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
  "needs-attention": "Needs attention",
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
  "source-control": "Source control",
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
  readonly onOpenFolder: () => void;
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

  const resetFilters = (): void => {
    onChange(clearSessionFilters(value));
  };

  return (
    <span {...stylex.props(styles.controls)}>
      <Menu
        label="Customize sidebar"
        side="right"
        align="start"
        popupStyle={styles.popup}
        trigger={
          <button
            type="button"
            disabled={filterDisabled}
            data-nyte-active={filtersActive || undefined}
            aria-label="Customize sidebar"
            title="Customize sidebar"
            {...stylex.props(styles.action, filtersActive && styles.actionActive, focus.ringInset)}
          >
            <IconFilter2 ariaHidden mode="raw" size={13} />
          </button>
        }
      >
        <MenuSubmenu label="Grouping" icon="folder" popupStyle={styles.popup}>
          <MenuRadioGroup
            value={value.grouping}
            onValueChange={(grouping) => {
              if (isOption(grouping, GROUPINGS)) onChange({ ...value, grouping });
            }}
          >
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
        </MenuSubmenu>
        <MenuSubmenu label="Ordering" icon="clock" popupStyle={styles.popup}>
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
        </MenuSubmenu>
        <MenuSubmenu label="Show" icon="eye" popupStyle={styles.popup}>
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
        </MenuSubmenu>
        <MenuSeparator />
        <MenuGroup
          label="Filters"
          action={filtersActive ? { label: "Reset", onSelect: resetFilters } : undefined}
        >
          <MenuSubmenu label="Status" icon="square" popupStyle={styles.popup}>
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
          </MenuSubmenu>
          <MenuSubmenu label="PR" icon="pull-request" popupStyle={styles.popup}>
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
          </MenuSubmenu>
          <MenuSubmenu label="Environment" icon="globe" popupStyle={styles.popup}>
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
          </MenuSubmenu>
          <MenuSubmenu label="Source" icon="apps" popupStyle={styles.popup}>
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
          </MenuSubmenu>
          <MenuCheckboxItem
            checked={value.archived}
            icon="archive"
            onCheckedChange={(archived) => onChange({ ...value, archived })}
          >
            Archived
          </MenuCheckboxItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon="folder" onSelect={onCollapseAll}>
          Collapse all
        </MenuItem>
        <MenuItem icon="inbox-checked" disabled onSelect={() => undefined}>
          Mark all as read
        </MenuItem>
      </Menu>
      <Hint
        content="Open Workspace"
        side="bottom"
        align="end"
        trigger={
          <button
            type="button"
            aria-label="Open folder…"
            {...stylex.props(styles.action, focus.ringInset)}
            onClick={onOpenFolder}
          >
            <IconFolderAddRight ariaHidden mode="raw" size={13} />
          </button>
        }
      />
    </span>
  );
}
