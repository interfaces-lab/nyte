/**
 * The composer's model chip. The menu holds the current model's parameters:
 * Fast when the model offers it, Reasoning when it has more than one level,
 * and the model itself in a searchable submenu grouped by provider. The host
 * decides which models are listed (Settings › Models); the picker also keeps
 * whatever the session already runs on.
 */
import {
  Autocomplete,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@nyte-ai/ui/autocomplete";
import { create, props } from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { memo, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ModelThinkingLevel } from "@nyte-ai/schema";
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import { menu } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { nyte, type DesktopCatalog, type DesktopModelOption } from "../nyte.ts";
import { isSettingsSection } from "../chrome/settings-navigation.tsx";
import { shellActions } from "../chrome/shell-state.ts";
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
      readonly thinkingLevel: ModelThinkingLevel;
    }
  | { readonly kind: "thinking"; readonly thinkingLevel: ModelThinkingLevel }
  | {
      readonly kind: "fast";
      readonly settingId: string;
      readonly enabled: boolean;
    };

const styles = create({
  trigger: { maxWidth: "100%", flexShrink: 1 },
  triggerName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  triggerDetail: { flexShrink: 0, color: role.contentSecondary, whiteSpace: "nowrap" },
  palette: {
    width: `min(${menu.modelWidth}, var(--available-width))`,
    maxWidth: "var(--available-width)",
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
    borderRadius: menu.radius,
  },
  parameterPalette: {
    width: `min(${menu.parameterWidth}, var(--available-width))`,
    minWidth: `min(${menu.parameterWidth}, var(--available-width))`,
    maxWidth: `min(${menu.parameterWidth}, var(--available-width))`,
  },
  modelPopup: { overflowY: "hidden" },
  empty: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 8px",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  emptyTitle: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});

interface ModelPickerProps {
  catalog: DesktopCatalog | undefined;
  current: DesktopModelOption | undefined;
  thinkingLevel: ModelThinkingLevel | undefined;
  /** Setting ids whose current choice is on. */
  fastEnabled: ReadonlySet<string>;
  disabled?: boolean;
  loading?: boolean;
  onChange: (change: ModelPickerChange) => void;
}

function ModelPickerView({
  catalog,
  current,
  thinkingLevel,
  fastEnabled,
  disabled = false,
  loading = false,
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
  // A server's models are the server's to change; the desktop manages that connection in Environments.
  const manage =
    catalog?.source === "server"
      ? nyte.clientSurface === "desktop"
        ? { label: "Environments…", open: () => shellActions.openEnvironments() }
        : undefined
      : isSettingsSection("providers")
        ? {
            label: connected ? "Manage Providers…" : "Connect a Provider…",
            href: "/settings/providers",
            open: () =>
              void navigate({ to: "/settings/$section", params: { section: "providers" } }),
          }
        : undefined;

  const levels = thinkingLevelsFor(current);
  const level = supportedThinkingLevel(current, thinkingLevel);
  const fast = current?.fastMode;
  const fastOn = fast?.kind === "available" && fastEnabled.has(fast.settingId);
  const label = modelTriggerLabel(current, thinkingLevel === undefined ? undefined : level, fastOn);
  const hasParameters = fast?.kind === "available" || levels.length > 1;

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setSearch("");
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            disabled={disabled}
            loading={loading}
            aria-description={
              label.detail === undefined
                ? `Model: ${label.name}`
                : `Model: ${label.name}, ${label.detail}`
            }
            xstyle={styles.trigger}
          >
            <span {...props(styles.triggerName)}>{label.name}</span>
            {label.detail !== undefined && (
              <span {...props(styles.triggerDetail)}>{label.detail}</span>
            )}
            <Icon name="chevron-down" size={10} />
          </Button>
        }
      />
      <MenuContent xstyle={styles.palette}>
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
          <MenuSub>
            <MenuSubTrigger layout="plain" value={THINKING_LABELS[level]}>
              Reasoning
            </MenuSubTrigger>
            <MenuSubContent align="center" xstyle={[styles.palette, styles.parameterPalette]}>
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
            </MenuSubContent>
          </MenuSub>
        )}

        {hasParameters && <MenuSeparator />}

        <MenuSub
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
          <MenuSubTrigger layout="plain" value={current?.name ?? "None"}>
            Model
          </MenuSubTrigger>
          <MenuSubContent align="center" xstyle={[styles.palette, styles.modelPopup]}>
            <Autocomplete
              inline
              open
              mode="none"
              autoHighlight
              items={groups.flatMap((group) => group.options)}
              value={search}
              itemToStringValue={(option) => option.name}
              onValueChange={setSearch}
            >
              <AutocompleteInput
                variant="inline"
                ref={searchRef}
                aria-label="Search models"
                placeholder="Search models"
              />
              <MenuSeparator />
              <AutocompleteList variant="inline" data-nyte-scrollport>
                {groups.length === 0 && (
                  <div {...props(styles.empty)}>
                    {search.trim() !== "" ? (
                      <span {...props(styles.emptyTitle)}>No models match "{search.trim()}"</span>
                    ) : catalog?.source === "server" ? (
                      <>
                        <span {...props(styles.emptyTitle)}>No server models available</span>
                        <span>Configure provider credentials on the server.</span>
                      </>
                    ) : connected ? (
                      <>
                        <span {...props(styles.emptyTitle)}>Every model is hidden</span>
                        <span>Enable models in Settings › Providers.</span>
                      </>
                    ) : (
                      <>
                        <span {...props(styles.emptyTitle)}>No providers connected</span>
                        <span>Connect a provider in Settings › Providers.</span>
                      </>
                    )}
                  </div>
                )}
                {groups.map((group) => (
                  <AutocompleteGroup key={group.provider.id}>
                    <AutocompleteGroupLabel variant="inline">
                      <span>{group.provider.name}</span>
                      {!group.provider.enabled ? (
                        <span>· Off</span>
                      ) : group.provider.connection.kind === "disconnected" ? (
                        <span>· Not connected</span>
                      ) : null}
                    </AutocompleteGroupLabel>
                    {group.options.map((option) => (
                      <AutocompleteItem
                        variant="inline"
                        key={option.key}
                        ref={option.key === current?.key ? currentOptionRef : undefined}
                        value={option}
                        selected={option.key === current?.key}
                        onClick={() => {
                          onChange({
                            kind: "model",
                            option,
                            thinkingLevel: supportedThinkingLevel(option, level),
                          });
                          setOpen(false);
                        }}
                      >
                        {option.name}
                      </AutocompleteItem>
                    ))}
                  </AutocompleteGroup>
                ))}
              </AutocompleteList>
            </Autocomplete>
            {manage !== undefined && (
              <>
                <MenuSeparator />
                {manage.href !== undefined ? (
                  <MenuLinkItem
                    layout="plain"
                    href={manage.href}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      manage.open();
                    }}
                  >
                    {manage.label}
                  </MenuLinkItem>
                ) : (
                  <MenuItem layout="plain" onClick={manage.open}>
                    {manage.label}
                  </MenuItem>
                )}
              </>
            )}
          </MenuSubContent>
        </MenuSub>
      </MenuContent>
    </Menu>
  );
}

export const ModelPicker = memo(ModelPickerView);
