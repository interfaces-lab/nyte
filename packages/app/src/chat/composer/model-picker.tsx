import { create, props, when } from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { availableModes } from "@nyte-ai/schema";
import type { ModelMode, ModelThinkingLevel } from "@nyte-ai/schema/model";
import { MODEL_MODES } from "@nyte-ai/schema/model";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuFilterProvider,
  MenuGroup,
  MenuGroupLabel,
  MenuInput,
  MenuItem,
  MenuList,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { glyph, menu, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useSetListing } from "../../data/catalog.ts";
import type { DesktopCatalog, DesktopModelOption } from "../../data/catalog.ts";
import { useAccountLimits } from "../../data/usage.ts";
import { preferences, useSetting } from "../../preferences/index.ts";
import { showsSettingsSection } from "../../settings-sections/sections.ts";
import {
  MODE_LABELS,
  modelIcon,
  modelTriggerLabel,
  pickerGroups,
  supportedModes,
  supportedThinkingLevel,
  THINKING_LABELS,
  thinkingLevelsFor,
  usageLine,
} from "./model-picker-state.ts";

export interface ModelPickerChange {
  readonly option: DesktopModelOption;
  readonly thinkingLevel: ModelThinkingLevel;
  readonly modes: readonly ModelMode[];
}

interface Settings {
  readonly thinking: ModelThinkingLevel;
  readonly modes: readonly ModelMode[];
}

const FADE = "linear-gradient(to left, transparent 15px, black 35px)";

const SUBMENU_OFFSET = 2;

const CARD_OFFSET = 14;

const styles = create({
  trigger: { maxWidth: "100%", flexShrink: 1 },
  name: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  triggerDetail: {
    display: "var(--_model-detail-display, inline)",
    flexShrink: 0,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },

  popup: {
    width: `min(${menu.modelWidth}, var(--available-width))`,
    minWidth: `min(${menu.modelWidth}, var(--available-width))`,
    maxWidth: `min(${menu.modelWidth}, var(--available-width))`,
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
    overflowY: "hidden",
  },
  frame: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
    "--nyte-menu-meta-min-width": "0px",
  },
  search: {
    display: "grid",
    flexShrink: 0,
    gridTemplateColumns: `${glyph.sm} minmax(0, 1fr)`,
    alignItems: "center",
    columnGap: menu.itemGap,
    paddingInline: menu.itemPaddingInline,
    color: role.contentTertiary,
  },
  searchGlass: { display: "inline-flex" },
  groupLabel: { marginInlineStart: `calc(${menu.itemPaddingInline} - ${space.s1_5})` },
  list: { marginInline: `calc(${menu.padding} * -1)` },
  scroll: {
    flex: "1 1 auto",
    minHeight: 0,
    paddingInlineStart: menu.padding,
    paddingInlineEnd: `calc(${menu.padding} + ${space.s2})`,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  footer: { paddingInline: menu.padding },
  empty: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    paddingInline: menu.itemPaddingInline,
    paddingBlock: space.s2,
    color: role.contentSecondary,
  },

  line: { display: "block", overflow: "hidden", whiteSpace: "nowrap" },
  lineFade: {
    maskImage: {
      default: "none",
      [when.ancestor("[data-highlighted]")]: FADE,
      [when.ancestor("[data-popup-open]")]: FADE,
    },
  },
  lineFadeAlways: { maskImage: FADE },
  detail: { color: role.contentTertiary },

  marks: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2_5,
    color: role.contentSecondary,
  },
  mark: { display: "inline-flex" },
  counterClockwise: { transform: "scaleX(-1)" },
  showOnHighlight: {
    display: { default: "none", [when.ancestor("[data-highlighted]")]: "inline-flex" },
  },
  hideOnHighlight: {
    display: { default: "inline-flex", [when.ancestor("[data-highlighted]")]: "none" },
  },
  edit: {
    display: {
      default: "none",
      [when.ancestor("[data-highlighted]")]: "inline",
      [when.ancestor("[data-popup-open]")]: "inline",
    },
  },

  sub: {
    width: `min(${menu.parameterWidth}, var(--available-width))`,
    minWidth: `min(${menu.parameterWidth}, var(--available-width))`,
    maxWidth: `min(${menu.parameterWidth}, var(--available-width))`,
  },

  card: { width: menu.parameterWidth },
  cardBody: { display: "flex", flexDirection: "column", gap: space.s2 },
  cardHead: { display: "flex", flexDirection: "column", gap: space.s0_5 },
  cardName: { fontWeight: type.weightMedium },
  cardLine: { color: role.contentSecondary },
  cardMeta: { color: role.contentTertiary },
});

export const ComposerPicker = createContext<
  | { readonly keyShortcuts: string; readonly editor: () => HTMLElement | null | undefined }
  | undefined
>(undefined);

interface ModelPickerProps {
  catalog: DesktopCatalog | undefined;
  current: DesktopModelOption | undefined;
  thinkingLevel: ModelThinkingLevel | undefined;
  modes: readonly ModelMode[];
  disabled?: boolean;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (change: ModelPickerChange) => void;
}

export function ModelPicker({
  catalog,
  current,
  thinkingLevel,
  modes,
  disabled = false,
  loading = false,
  open: openProp,
  onOpenChange,
  onChange,
}: ModelPickerProps): ReactElement {
  const composer = use(ComposerPicker);
  const navigate = useNavigate();
  const saved = useSetting(preferences.modelSettings);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const level = supportedThinkingLevel(current, thinkingLevel);
  const active = current === undefined ? [] : supportedModes(current, modes);
  const label = modelTriggerLabel(current, level, active);

  const groups = catalog === undefined ? [] : pickerGroups(catalog, current, query);

  const settingsFor = (option: DesktopModelOption): Settings => {
    if (option.key === current?.key) return { thinking: level, modes: active };

    const stored = saved[option.key];

    return {
      thinking: supportedThinkingLevel(option, stored?.thinking),
      modes: supportedModes(
        option,
        MODEL_MODES.filter((mode) => stored?.[mode] === true),
      ),
    };
  };

  const choose = (option: DesktopModelOption, next: Settings) => {
    preferences.modelSettings.set({
      ...saved,
      [option.key]: {
        thinking: next.thinking,
        fast: next.modes.includes("fast"),
        daybreak: next.modes.includes("daybreak"),
      },
    });
    onChange({ option, thinkingLevel: next.thinking, modes: next.modes });
  };

  return (
    <MenuFilterProvider filter={null} autoHighlight value={query} onValueChange={setQuery}>
      <Menu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next) setEditing(null);
        }}
      >
        <MenuTrigger
          render={
            <Button
              size="sm"
              disabled={disabled}
              loading={loading}
              aria-keyshortcuts={composer?.keyShortcuts}
              aria-description={
                label.detail === undefined
                  ? `Model: ${label.name}`
                  : `Model: ${label.name}, ${label.detail}`
              }
              xstyle={styles.trigger}
            >
              <span {...props(styles.name)}>{label.name}</span>
              {label.detail !== undefined && (
                <span {...props(styles.triggerDetail)}>{label.detail}</span>
              )}
              <Icon name="chevron-down" size="2xs" />
            </Button>
          }
        />
        <MenuContent
          aria-label="Model"
          side="top"
          align="start"
          sideOffset={6}
          finalFocus={composer?.editor}
          xstyle={styles.popup}
        >
          <div {...props(styles.frame)}>
            <div {...props(styles.search)}>
              <span aria-hidden="true" {...props(styles.searchGlass)}>
                <Icon name="search" size="sm" />
              </span>
              <MenuInput aria-label="Search models" placeholder="Search models" />
            </div>
            <MenuSeparator />
            <MenuList xstyle={styles.list}>
              <div data-nyte-scrollport {...props(styles.scroll)}>
                {groups.length === 0 && <Empty catalog={catalog} query={query} />}
                {groups.map((group) => (
                  <MenuGroup key={group.id}>
                    {groups.length > 1 && (
                      <MenuGroupLabel xstyle={styles.groupLabel}>
                        {group.disconnected ? `${group.label} · Not connected` : group.label}
                      </MenuGroupLabel>
                    )}
                    {group.options.map((option) => (
                      <ModelRow
                        key={option.key}
                        option={option}
                        current={option.key === current?.key}
                        settings={settingsFor(option)}
                        editing={editing === option.key}
                        peeks={editing === null}
                        onEditing={(next) => {
                          setEditing(next ? option.key : null);

                          if (next) choose(option, settingsFor(option));
                        }}
                        onPick={() => {
                          choose(option, settingsFor(option));
                          setOpen(false);
                        }}
                        onChange={(next) => choose(option, next)}
                      />
                    ))}
                  </MenuGroup>
                ))}
              </div>
              {showsSettingsSection("providers") && (
                <>
                  <MenuSeparator />
                  <div {...props(styles.footer)}>
                    <MenuItem
                      variant="quiet"
                      icon="settings"
                      onClick={() =>
                        void navigate({
                          to: "/settings/$section",
                          params: { section: "providers" },
                        })
                      }
                    >
                      Manage Providers…
                    </MenuItem>
                  </div>
                </>
              )}
            </MenuList>
          </div>
        </MenuContent>
      </Menu>
    </MenuFilterProvider>
  );
}

function Empty({
  catalog,
  query,
}: {
  readonly catalog: DesktopCatalog | undefined;
  readonly query: string;
}): ReactElement {
  const connected =
    catalog?.providers.some(
      (provider) => provider.credential !== "missing" && provider.credential !== "unknown",
    ) ?? false;

  const unknown = catalog?.providers.some((provider) => provider.credential === "unknown") ?? false;

  if (query.trim() !== "") return <EmptyText title={`No models match "${query.trim()}"`} />;

  if (unknown) return <EmptyText title="No models available" />;

  if (connected) {
    return (
      <EmptyText title="Every model is hidden">Enable models in Settings › Providers.</EmptyText>
    );
  }

  return (
    <EmptyText title="No providers connected">
      Connect a provider in Settings › Providers.
    </EmptyText>
  );
}

function EmptyText({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div {...props(text.sm, styles.empty)}>
      <span {...props(text.base)}>{title}</span>
      {children !== undefined && <span>{children}</span>}
    </div>
  );
}

function ModelRow({
  option,
  current,
  settings,
  editing,
  peeks,
  onEditing,
  onPick,
  onChange,
}: {
  readonly option: DesktopModelOption;
  readonly current: boolean;
  readonly settings: Settings;
  readonly editing: boolean;
  readonly peeks: boolean;
  readonly onEditing: (open: boolean) => void;
  readonly onPick: () => void;
  readonly onChange: (next: Settings) => void;
}): ReactElement {
  const setListing = useSetListing();
  const levels = thinkingLevelsFor(option);
  const offered = availableModes(option.info);
  const starred = option.listing === "favorite";
  const defaults: Settings = { thinking: supportedThinkingLevel(option, undefined), modes: [] };
  const moved = settings.thinking !== defaults.thinking || settings.modes.length !== 0;
  const detail = modelTriggerLabel(option, settings.thinking, settings.modes).detail;

  const marks = (
    <span aria-hidden="true" {...props(styles.marks)}>
      {moved && (
        <span
          data-row-reset
          {...props(styles.mark, styles.counterClockwise, styles.showOnHighlight)}
        >
          <Icon name="refresh" size="xs" />
        </span>
      )}
      {current && (
        <span {...props(styles.mark, moved && styles.hideOnHighlight)}>
          <Icon name="checkmark" size="2xs" />
        </span>
      )}
      <span data-row-edit {...props(styles.edit)}>
        Edit
      </span>
    </span>
  );

  return (
    <MenuSub
      open={editing}
      onOpenChange={(next, details) => {
        if (!next) {
          onEditing(false);

          return;
        }

        const target = details.event.target;
        const pressed = details.reason === "trigger-press" && target instanceof Element;

        if (pressed && target.closest("[data-row-reset]") !== null) {
          details.cancel();
          onChange(defaults);

          return;
        }

        if (pressed && target.closest("[data-row-edit]") === null) {
          details.cancel();
          onPick();

          return;
        }

        onEditing(true);
      }}
    >
      <PreviewCard>
        <PreviewCardTrigger
          delay={600}
          closeDelay={0}
          render={<MenuSubTrigger openOnHover={false} icon={modelIcon(option)} meta={marks} />}
        >
          <span {...props(styles.line, current ? styles.lineFadeAlways : styles.lineFade)}>
            {option.name}
            {detail !== undefined && <span {...props(styles.detail)}> {detail}</span>}
            {current && <span {...props(srOnly)}>, current</span>}
          </span>
        </PreviewCardTrigger>
        {peeks && (
          <PreviewCardContent
            side="right"
            align="start"
            sideOffset={CARD_OFFSET}
            xstyle={styles.card}
          >
            <ModelCard option={option} settings={settings} />
          </PreviewCardContent>
        )}
      </PreviewCard>
      <MenuSubContent sideOffset={SUBMENU_OFFSET} xstyle={styles.sub}>
        {levels.length > 1 && (
          <MenuGroup>
            <MenuGroupLabel>Effort</MenuGroupLabel>
            <MenuRadioGroup
              value={settings.thinking}
              onValueChange={(value) => {
                const thinking = levels.find((entry) => entry === value);

                if (thinking !== undefined) onChange({ ...settings, thinking });
              }}
            >
              {levels.map((entry) => (
                <MenuRadioItem key={entry} value={entry} closeOnClick={false} layout="plain">
                  {THINKING_LABELS[entry]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        )}
        {levels.length > 1 && offered.length !== 0 && <MenuSeparator />}
        {offered.map((mode) => (
          <MenuSwitchItem
            key={mode}
            layout="plain"
            closeOnClick={false}
            checked={settings.modes.includes(mode)}
            onCheckedChange={(checked) =>
              onChange({
                ...settings,
                modes: MODEL_MODES.filter((entry) =>
                  entry === mode ? checked : settings.modes.includes(entry),
                ),
              })
            }
          >
            {MODE_LABELS[mode]}
          </MenuSwitchItem>
        ))}
        {(levels.length > 1 || offered.length !== 0) && <MenuSeparator />}
        <MenuItem
          layout="plain"
          closeOnClick={false}
          onClick={() =>
            setListing.mutate({
              models: [{ provider: option.provider, id: option.id }],
              listing: starred ? "shown" : "favorite",
            })
          }
        >
          {starred ? "Unstar" : "Star"}
        </MenuItem>
      </MenuSubContent>
    </MenuSub>
  );
}

function ModelCard({
  option,
  settings,
}: {
  readonly option: DesktopModelOption;
  readonly settings: Settings;
}): ReactElement {
  const limits = useAccountLimits();
  const usage = usageLine(limits.data?.accounts, option);
  const levels = thinkingLevelsFor(option);

  const reasoning =
    levels.length > 1
      ? `${THINKING_LABELS[settings.thinking]} effort`
      : option.agent
        ? "Sets its own reasoning"
        : undefined;

  return (
    <div {...props(styles.cardBody)}>
      <span {...props(styles.cardHead)}>
        <span {...props(styles.cardName)}>{option.name}</span>
        {usage !== undefined && <span {...props(text.sm, styles.cardLine)}>{usage}</span>}
      </span>
      <span {...props(text.sm, styles.cardMeta)}>
        {contextLabel(option.contextWindow)} context window
        {reasoning !== undefined && ` · ${reasoning}`}
      </span>
    </div>
  );
}

function contextLabel(tokens: number): string {
  return tokens >= 1_000_000
    ? `${String(Math.round(tokens / 100_000) / 10)}M`
    : `${String(Math.round(tokens / 1000))}K`;
}
