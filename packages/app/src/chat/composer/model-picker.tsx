import { create, props, when } from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ModelThinkingLevel } from "@nyte-ai/schema/model";
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
import { showsSettingsSection } from "../../settings/index.ts";
import {
  AGENT_PROVIDERS,
  modelIcon,
  modelTriggerLabel,
  pickerGroups,
  supportedThinkingLevel,
  THINKING_LABELS,
  thinkingLevelsFor,
  usageLine,
} from "./model-picker-state.ts";

/** The model a chat runs, with that model's effort and Fast. */
export interface ModelPickerChange {
  readonly option: DesktopModelOption;
  readonly thinkingLevel: ModelThinkingLevel;
  readonly fast: boolean;
}

interface Settings {
  readonly thinking: ModelThinkingLevel;
  readonly fast: boolean;
}

/** Fades a row's text out before its end marks, leaving 21px clear with the row's own gap. */
const FADE = "linear-gradient(to left, transparent 15px, black 35px)";

/** The submenu starts 2px past a row, reaching over the menu's edge so its shadow falls on it. */
const SUBMENU_OFFSET = 2;

/** The card starts at the menu's edge: the list's end padding and gutter past a row. */
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
  /** Rows hold no room for marks they don't show; the fade makes room when they appear. */
  frame: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
    "--nyte-menu-meta-min-width": "0px",
  },
  /** The rows' grid: the search glass sits in the icon column, the field in the label column. */
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
  /** A group label starts on the icon column, where the rows below it start. */
  groupLabel: { marginInlineStart: `calc(${menu.itemPaddingInline} - ${space.s1_5})` },
  /** A gutter beside the rows, as in Cursor's list, that the submenu overlaps. */
  /** The list spans the popup's padding, so its rules run edge to edge like the search's. */
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
  /** The only reset glyph turns clockwise; mirrored, it turns back. */
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
  fast: boolean;
  disabled?: boolean;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (change: ModelPickerChange) => void;
}

/**
 * One flat list where every model carries its own effort and Fast. Pressing a row picks the model
 * with them and closes; Edit, or Right, picks it and opens them in a submenu beside the row.
 */
export function ModelPicker({
  catalog,
  current,
  thinkingLevel,
  fast,
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
  const fastOn = current?.fastMode.kind === "available" && fast;
  const label = modelTriggerLabel(current, level, fastOn);

  const groups = catalog === undefined ? [] : pickerGroups(catalog, current, query);

  const settingsFor = (option: DesktopModelOption): Settings => {
    if (option.key === current?.key) return { thinking: level, fast: fastOn };

    const stored = saved[option.key];

    return {
      thinking: supportedThinkingLevel(option, stored?.thinking),
      fast: option.fastMode.kind === "available" && stored?.fast === true,
    };
  };

  const choose = (option: DesktopModelOption, next: Settings) => {
    preferences.modelSettings.set({ ...saved, [option.key]: next });
    onChange({ option, thinkingLevel: next.thinking, fast: next.fast });
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

  if (connected)
    return (
      <EmptyText title="Every model is hidden">Enable models in Settings › Providers.</EmptyText>
    );

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

/**
 * One model: its name and settings, a check when the chat runs it, and Edit on hover. Edit opens
 * its effort, Fast and star. The reset mark puts a changed model back to its lowest effort without
 * Fast. Resting on the row shows the model's card.
 */
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
  const fastAvailable = option.fastMode.kind === "available";
  const starred = option.listing === "favorite";
  const defaults: Settings = { thinking: supportedThinkingLevel(option, undefined), fast: false };
  const moved = settings.thinking !== defaults.thinking || settings.fast !== defaults.fast;
  const detail = modelTriggerLabel(option, settings.thinking, settings.fast).detail;

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
        {levels.length > 1 && fastAvailable && <MenuSeparator />}
        {fastAvailable && (
          <MenuSwitchItem
            layout="plain"
            closeOnClick={false}
            checked={settings.fast}
            onCheckedChange={(fast) => onChange({ ...settings, fast })}
          >
            Fast
          </MenuSwitchItem>
        )}
        {(levels.length > 1 || fastAvailable) && <MenuSeparator />}
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
  const usage = usageLine(limits.data, option);
  const levels = thinkingLevelsFor(option);

  const reasoning = AGENT_PROVIDERS.has(option.provider)
    ? "Sets its own reasoning"
    : levels.length > 1
      ? `${THINKING_LABELS[settings.thinking]} effort`
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
