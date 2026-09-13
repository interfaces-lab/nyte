/**
 * The composer's model chip. The menu holds the current model's parameters:
 * Fast when the model offers it, Reasoning when it has more than one level,
 * and the model itself in a searchable submenu grouped by provider. The host
 * decides which models are listed (Settings › Models); the picker also keeps
 * whatever the session already runs on.
 */
import { Autocomplete } from "@nyte-ai/ui/autocomplete";
import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { memo, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ThinkingLevel } from "@nyte-ai/core";
import { Icon } from "../components/icons.tsx";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSwitchItem,
} from "../components/menu.tsx";
import { focus } from "../components/ui.tsx";
import { control } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import type { DesktopCatalog, DesktopModelOption } from "../nyte.ts";
import {
  modelTriggerLabel,
  pickerGroups,
  supportedThinkingLevel,
  THINKING_LABELS,
  thinkingLevelsFor,
} from "./model-picker-state.ts";

export type ModelPickerChange =
  | {
      readonly kind: "model";
      readonly option: DesktopModelOption;
      readonly thinkingLevel: ThinkingLevel;
    }
  | { readonly kind: "thinking"; readonly thinkingLevel: ThinkingLevel }
  | {
      readonly kind: "fast";
      readonly settingId: string;
      readonly enabled: boolean;
    };

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    height: 24,
    paddingInline: 7,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: {
      default: t.textSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.textPrimary },
    },
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { ":disabled": 0.5 },
    flexShrink: 1,
  },
  triggerName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  triggerDetail: { flexShrink: 0, color: t.textTertiary, whiteSpace: "nowrap" },
  palette: {
    width: `min(${control.modelMenuWidth}, var(--available-width))`,
    maxWidth: "var(--available-width)",
    maxHeight: `min(${control.menuMaxHeight}, var(--available-height))`,
    borderRadius: t.radius2xl,
  },
  parameterPalette: {
    width: `min(${control.parameterMenuWidth}, var(--available-width))`,
    minWidth: `min(${control.parameterMenuWidth}, var(--available-width))`,
    maxWidth: `min(${control.parameterMenuWidth}, var(--available-width))`,
  },
  modelPopup: { overflowY: "hidden" },
  // The same anatomy as the footer item: compact height inside the popup's
  // padding, text on the rows' inline edge, the shared separator beneath.
  // flexShrink: 0 because the popup is a capped flex column and the list
  // takes the slack; without it the field is squeezed on long lists.
  search: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: control.compactHeight,
    paddingInline: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    "::placeholder": { color: t.textTertiary },
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    marginInline: -4,
    paddingInline: 4,
  },
  groupLabel: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    paddingInline: 8,
    paddingBlock: "4px 3px",
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    userSelect: "none",
  },
  modelItem: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 14px",
    alignItems: "center",
    columnGap: 8,
    minHeight: control.compactHeight,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: t.radiusLg,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": t.bgCard,
      "[data-nyte-selected='true']": t.fillGhostHover,
    },
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    cursor: "default",
    userSelect: "none",
  },
  modelName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  modelCheck: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    color: t.textSecondary,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 8px",
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  emptyTitle: { color: t.textSecondary, fontSize: t.fontBase, lineHeight: t.leadingBase },
});

export interface ModelPickerProps {
  catalog: DesktopCatalog | undefined;
  current: DesktopModelOption | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  /** Setting ids whose current choice is on. */
  fastEnabled: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (change: ModelPickerChange) => void;
}

function ModelPickerView({
  catalog,
  current,
  thinkingLevel,
  fastEnabled,
  disabled = false,
  onChange,
}: ModelPickerProps): ReactElement {
  const navigate = useNavigate();
  // A model is an Autocomplete item inside a submenu, so its press must close the outer menu.
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const currentOptionRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () => (catalog === undefined ? [] : pickerGroups(catalog, current, search)),
    [catalog, current, search],
  );
  const connected =
    catalog?.providers.some((provider) => provider.connection.kind !== "disconnected") ?? false;
  const levels = thinkingLevelsFor(current);
  const level = supportedThinkingLevel(current, thinkingLevel);
  const fast = current?.fastMode;
  const fastOn = fast?.kind === "available" && fastEnabled.has(fast.settingId);
  const label = modelTriggerLabel(current, thinkingLevel === undefined ? undefined : level, fastOn);
  const hasParameters = fast?.kind === "available" || levels.length > 1;

  return (
    <Menu
      label="Model"
      open={open}
      onOpenChange={setOpen}
      popupStyle={styles.palette}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setSearch("");
      }}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={
            label.detail === undefined
              ? `Model: ${label.name}`
              : `Model: ${label.name}, ${label.detail}`
          }
          {...stylex.props(styles.trigger, focus.ring)}
        >
          <span {...stylex.props(styles.triggerName)}>{label.name}</span>
          {label.detail !== undefined && (
            <span {...stylex.props(styles.triggerDetail)}>{label.detail}</span>
          )}
          <Icon name="chevron-down" size={10} />
        </button>
      }
    >
      {fast?.kind === "available" && (
        <MenuSwitchItem
          layout="plain"
          checked={fastOn}
          onCheckedChange={(enabled) =>
            onChange({ kind: "fast", settingId: fast.settingId, enabled })
          }
        >
          Fast
        </MenuSwitchItem>
      )}

      {levels.length > 1 && (
        <MenuSubmenu
          label="Reasoning"
          layout="plain"
          align="center"
          value={THINKING_LABELS[level]}
          popupStyle={[styles.palette, styles.parameterPalette]}
        >
          <MenuRadioGroup
            value={level}
            onValueChange={(value) => {
              const next = levels.find((candidate) => candidate === value);
              if (next !== undefined) onChange({ kind: "thinking", thinkingLevel: next });
            }}
          >
            {levels.map((candidate) => (
              <MenuRadioItem key={candidate} value={candidate} layout="plain">
                {THINKING_LABELS[candidate]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubmenu>
      )}

      {hasParameters && <MenuSeparator />}

      <MenuSubmenu
        label="Model"
        layout="plain"
        align="center"
        value={current?.name ?? "None"}
        popupStyle={[styles.palette, styles.modelPopup]}
        onOpenChangeComplete={(modelOpen) => {
          if (!modelOpen) {
            setSearch("");
            return;
          }
          window.requestAnimationFrame(() => {
            currentOptionRef.current?.scrollIntoView({ block: "nearest" });
            searchRef.current?.focus({ preventScroll: true });
          });
        }}
      >
        <Autocomplete.Root
          inline
          open
          mode="none"
          autoHighlight
          items={groups.flatMap((group) => group.options)}
          value={search}
          itemToStringValue={(option) => option.name}
          onValueChange={setSearch}
        >
          <label {...stylex.props(styles.search)}>
            <Autocomplete.Input
              ref={searchRef}
              aria-label="Search models"
              {...stylex.props(styles.searchInput)}
              placeholder="Search models"
            />
          </label>
          <MenuSeparator />
          <Autocomplete.List data-nyte-scrollport {...stylex.props(styles.list)}>
            {groups.length === 0 && (
              <div {...stylex.props(styles.empty)}>
                {search.trim() !== "" ? (
                  <span {...stylex.props(styles.emptyTitle)}>No models match</span>
                ) : catalog?.source === "server" ? (
                  <>
                    <span {...stylex.props(styles.emptyTitle)}>No server models available</span>
                    <span>Configure provider credentials on the server.</span>
                  </>
                ) : connected ? (
                  <>
                    <span {...stylex.props(styles.emptyTitle)}>Every model is hidden</span>
                    <span>Show some in Settings › Models.</span>
                  </>
                ) : (
                  <>
                    <span {...stylex.props(styles.emptyTitle)}>No providers connected</span>
                    <span>Sign in or add an API key in Settings › Models.</span>
                  </>
                )}
              </div>
            )}
            {groups.map((group) => (
              <div key={group.provider.id} role="group" aria-label={group.provider.name}>
                <div aria-hidden="true" {...stylex.props(styles.groupLabel)}>
                  <span>{group.provider.name}</span>
                  {!group.provider.enabled ? (
                    <span>· Off</span>
                  ) : group.provider.connection.kind === "disconnected" ? (
                    <span>· Not connected</span>
                  ) : null}
                </div>
                {group.options.map((option) => (
                  <Autocomplete.Item
                    key={option.key}
                    ref={option.key === current?.key ? currentOptionRef : undefined}
                    value={option}
                    data-nyte-selected={option.key === current?.key}
                    {...stylex.props(styles.modelItem)}
                    onClick={() => {
                      onChange({
                        kind: "model",
                        option,
                        thinkingLevel: supportedThinkingLevel(option, level),
                      });
                      setOpen(false);
                    }}
                  >
                    <span {...stylex.props(styles.modelName)}>{option.name}</span>
                    <span aria-hidden="true" {...stylex.props(styles.modelCheck)}>
                      {option.key === current?.key && <Icon name="checkmark" size={11} />}
                    </span>
                  </Autocomplete.Item>
                ))}
              </div>
            ))}
          </Autocomplete.List>
        </Autocomplete.Root>
        <MenuSeparator />
        <MenuItem
          layout="plain"
          onSelect={() =>
            void navigate({
              to: "/settings/$section",
              params: { section: catalog?.source === "server" ? "server" : "models" },
            })
          }
        >
          {catalog?.source === "server"
            ? "Server settings…"
            : connected
              ? "Manage models…"
              : "Connect a provider…"}
        </MenuItem>
      </MenuSubmenu>
    </Menu>
  );
}

export const ModelPicker = memo(ModelPickerView);
