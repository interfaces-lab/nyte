/** Takes on the settings side: the default model on Agent, and the model list on Providers. */
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { Popover } from "@nyte-ai/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { DesktopModelOption } from "@nyte-ai/app/data/catalog.ts";
import { providerIcon } from "@nyte-ai/app/chat/composer/model-picker-state.ts";
import { ConnectionRow, ConnectionStatus } from "@nyte-ai/app/components/connection-list.tsx";
import { SettingsRow, SettingsSection } from "@nyte-ai/app/settings/rows.tsx";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { catalog } from "./fixtures";
import {
  ChipFace,
  FastRow,
  ModelLabel,
  ModelSearch,
  ReasoningField,
  chipDescription,
  contextMeta,
  partStyles,
} from "./parts";
import { useChoice, useListings } from "./state";

const styles = create({
  stage: {
    display: "flex",
    flexDirection: "column",
    gap: space.s8,
    paddingBlock: space.s6,
    paddingInline: space.s6,
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderPrimary}`,
    containerType: "inline-size",
  },
  pageLabel: {
    marginBlockEnd: `calc(${space.s4} * -1)`,
    paddingInline: space.s1,
    color: role.contentTertiary,
  },
  trigger: { maxWidth: "100%" },

  panel: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    paddingInline: space.s3,
    paddingBlock: space.s2,
    color: role.contentSecondary,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
  },
  oldRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    alignItems: "center",
    columnGap: space.s2,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s2,
    paddingBlock: space.s1,
  },
  oldName: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  oldMeta: { color: role.contentTertiary },
  controls: { display: "inline-flex", alignItems: "center", gap: space.s1 },

  search: { paddingInline: space.s1 },
  groupHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: row.heightMd,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s2,
    paddingBlockStart: space.s2,
    color: role.contentSecondary,
  },
  groupName: { flex: 1, fontWeight: type.weightMedium },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    alignItems: "center",
    columnGap: space.s2,
    minHeight: row.heightLg,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s2,
  },
  rowHidden: { color: role.contentTertiary },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    paddingInline: space.s1_5,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
  },
  rowLabel: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  empty: { paddingBlock: space.s4, paddingInline: space.s3, color: role.contentSecondary },
});

function Stage({ children }: { readonly children: ReactNode }): ReactElement {
  return <div {...props(text.base, styles.stage)}>{children}</div>;
}

function PageLabel({ children }: { readonly children: string }): ReactElement {
  return <span {...props(text.sm, styles.pageLabel)}>{children}</span>;
}

/** Agent and Providers as they ship: a Select of every model, and a star and switch per row. */
export function SettingsToday(): ReactElement {
  const [model, setModel] = useState("anthropic/claude-opus-4-5");
  const { catalog: listed, setListing } = useListings();
  const providerNames = new Map(catalog.providers.map((entry) => [entry.id, entry.name]));

  const options = listed.models
    .filter((option) => option.listed)
    .map((option) => ({
      value: option.key,
      label: `${option.name} · ${providerNames.get(option.provider) ?? option.provider}`,
    }));

  const anthropic = listed.models.filter((option) => option.provider === "anthropic");

  return (
    <Stage>
      <PageLabel>Settings › Agent</PageLabel>
      <SettingsSection title="New chats">
        <SettingsRow
          title="Model"
          controlWidth="wide"
          description="New chats start on this model. Switch per chat from the composer"
        >
          <Select items={options} value={model} onValueChange={(key) => key && setModel(key)}>
            <SelectTrigger aria-label="Default model" width="wide">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>
      <PageLabel>Settings › Providers</PageLabel>
      <section {...props(settingsPatterns.section)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <h3 {...props(settingsPatterns.sectionTitle)}>Connected providers</h3>
        </div>
        <div {...props(settingsPatterns.group)}>
          <ConnectionRow
            glyph={<Icon name={providerIcon("anthropic")} size="lg" />}
            title="Anthropic"
            detail="3 models · 1 starred"
            control={
              <span {...props(styles.controls)}>
                <ConnectionStatus tone="on">Connected</ConnectionStatus>
                <Button variant="outline" aria-expanded>
                  Models
                  <Icon name="chevron-down" size="xs" />
                </Button>
              </span>
            }
            expansion={
              <div {...props(styles.panel)}>
                <div {...props(text.sm, styles.panelHeader)}>
                  <span>
                    Pick a model from the composer’s model menu. Starred models show first
                  </span>
                  <Button size="sm" variant="ghost">
                    Hide All
                  </Button>
                </div>
                {anthropic.map((option) => {
                  const favorite = option.listing === "favorite";
                  const shown = option.listing !== "hidden";

                  return (
                    <div key={option.key} {...props(styles.oldRow)}>
                      <span {...props(text.base, styles.oldName, !shown && styles.rowHidden)}>
                        {option.name}
                        <span {...props(text.sm, styles.oldMeta)}>{contextMeta(option)}</span>
                      </span>
                      <Button
                        iconOnly
                        size="sm"
                        aria-label={favorite ? `Unstar ${option.name}` : `Star ${option.name}`}
                        aria-pressed={favorite}
                        disabled={!shown}
                        onClick={() => setListing([option.key], favorite ? "shown" : "favorite")}
                      >
                        {favorite ? (
                          <Icon name="star" variant="filled" size="sm" />
                        ) : (
                          <Icon name="star" size="sm" />
                        )}
                      </Button>
                      <Switch
                        label={`Show ${option.name}`}
                        checked={shown}
                        onCheckedChange={(show) =>
                          setListing([option.key], show ? "shown" : "hidden")
                        }
                      />
                    </div>
                  );
                })}
              </div>
            }
          />
        </div>
      </section>
    </Stage>
  );
}

/** The default model opens the composer's own picker, so both places read the same. */
export function SamePicker(): ReactElement {
  const choice = useChoice();
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  return (
    <Stage>
      <PageLabel>Settings › Agent</PageLabel>
      <SettingsSection
        title="New chats"
        note="Default reasoning would be new: today only the model and Fast are saved."
      >
        <SettingsRow
          title="Model"
          controlWidth="wide"
          description="New chats start here. Change it per chat from the composer"
        >
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger
              render={
                <Button
                  variant="outline"
                  aria-description={chipDescription(choice)}
                  xstyle={styles.trigger}
                >
                  <ChipFace choice={choice} />
                </Button>
              }
            />
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={6}>
                <Popover.Popup
                  aria-label="Default model"
                  initialFocus={search}
                  xstyle={partStyles.palette}
                >
                  <ModelSearch
                    catalog={catalog}
                    current={choice.current}
                    inputRef={search}
                    onPick={(option) => {
                      choice.pick(option);
                      setOpen(false);
                    }}
                  />
                  {(choice.reasons || choice.fastAvailable) && (
                    <>
                      <div {...props(partStyles.rule)} />
                      <div {...props(partStyles.footer)}>
                        {choice.reasons && (
                          <ReasoningField
                            label="Default reasoning"
                            levels={choice.levels}
                            value={choice.thinking}
                            onChange={choice.setThinking}
                          />
                        )}
                        {choice.fastAvailable && (
                          <FastRow checked={choice.fast} onChange={choice.setFast} />
                        )}
                      </div>
                    </>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </SettingsRow>
      </SettingsSection>
    </Stage>
  );
}

/**
 * Every connected model in one searchable list on Providers, drawn with the picker's own row.
 * Starring and hiding stay here; the default is marked where it is chosen.
 */
export function OneList(): ReactElement {
  const { catalog: listed, setListing } = useListings();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  const groups = listed.providers
    .filter((entry) => entry.credential !== "missing")
    .map((entry) => ({
      provider: entry,
      models: listed.models.filter(
        (option) =>
          option.provider === entry.id &&
          `${option.name}\n${entry.name}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.models.length > 0);

  return (
    <Stage>
      <PageLabel>Settings › Providers</PageLabel>
      <SettingsSection
        title="Models"
        description="Starred models come first in the composer. Hidden models don’t appear there"
      >
        <div {...props(styles.search)}>
          <Input
            aria-label="Search models"
            placeholder="Search models"
            value={search}
            onValueChange={setSearch}
          />
        </div>
        {groups.length === 0 && (
          <div {...props(styles.empty)}>No models match “{search.trim()}”</div>
        )}
        {groups.map((group) => {
          const hidden = group.models.filter((option) => option.listing === "hidden");

          return (
            <div key={group.provider.id} {...props(settingsPatterns.rowRule)}>
              <div {...props(text.sm, styles.groupHead)}>
                <span {...props(styles.groupName)}>{group.provider.name}</span>
                {group.models.length > 1 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setListing(
                        (hidden.length > 0
                          ? hidden
                          : group.models.filter((option) => option.listing !== "favorite")
                        ).map((option) => option.key),
                        hidden.length > 0 ? "shown" : "hidden",
                      )
                    }
                  >
                    {hidden.length > 0 ? "Show All" : "Hide All"}
                  </Button>
                )}
              </div>
              {group.models.map((option) => (
                <ListRow
                  key={option.key}
                  option={option}
                  isDefault={option.key === "anthropic/claude-opus-4-5"}
                  onListing={(listing) => setListing([option.key], listing)}
                />
              ))}
            </div>
          );
        })}
      </SettingsSection>
    </Stage>
  );
}

function ListRow({
  option,
  isDefault,
  onListing,
}: {
  readonly option: DesktopModelOption;
  readonly isDefault: boolean;
  readonly onListing: (listing: DesktopModelOption["listing"]) => void;
}): ReactElement {
  const favorite = option.listing === "favorite";
  const shown = option.listing !== "hidden";

  return (
    <div {...props(styles.row, !shown && styles.rowHidden)}>
      <span {...props(styles.rowLabel)}>
        <ModelLabel option={option} meta={contextMeta(option)} />
        {isDefault && <span {...props(text.sm, styles.badge)}>Default</span>}
      </span>
      <Toggle
        iconOnly
        size="sm"
        indicator="glyph"
        aria-label={`Star ${option.name}`}
        pressed={favorite}
        disabled={!shown}
        onPressedChange={(pressed) => onListing(pressed ? "favorite" : "shown")}
      >
        {favorite ? (
          <Icon name="star" variant="filled" size="sm" />
        ) : (
          <Icon name="star" size="sm" />
        )}
      </Toggle>
      <Switch
        label={`Show ${option.name} in the composer`}
        checked={shown}
        onCheckedChange={(show) => onListing(show ? "shown" : "hidden")}
      />
    </div>
  );
}
