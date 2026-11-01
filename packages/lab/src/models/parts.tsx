/** The pieces every take shares: one row anatomy, one search list, one reasoning control. */
import { create, props } from "@stylexjs/stylex";
import { useId, useState } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import type { Thinking } from "@nyte-ai/sdk";
import {
  Autocomplete,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteSeparator,
} from "@nyte-ai/ui/autocomplete";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { menu, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { DesktopCatalog, DesktopModelOption } from "@nyte-ai/app/data/catalog.ts";
import {
  modelIcon,
  pickerGroups,
  THINKING_LABELS,
} from "@nyte-ai/app/chat/composer/model-picker-state.ts";
import { compactTokens, type Choice } from "./state";

const styles = create({
  label: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0, flex: 1 },
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: {
    flexShrink: 0,
    marginInlineStart: "auto",
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  glyph: { display: "inline-flex", flexShrink: 0, color: role.contentSecondary },
  empty: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    padding: `${space.s2_5} ${space.s2}`,
    color: role.contentSecondary,
  },

  chip: { display: "inline-flex", alignItems: "center", gap: space.s1_5, minWidth: 0 },
  chipName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chipDetail: { flexShrink: 0, color: role.contentSecondary, whiteSpace: "nowrap" },
  chipChevron: { display: "inline-flex", color: role.contentTertiary },

  field: { display: "flex", flexDirection: "column", gap: space.s1_5 },
  fieldLabel: { paddingInline: space.s0_5, color: role.contentSecondary },
  segmented: { width: "100%" },
  segment: { flex: 1, minWidth: 0 },

  switchRow: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: row.heightMd,
    paddingInline: space.s0_5,
  },
  switchLabel: { display: "inline-flex", alignItems: "center", gap: space.s1_5, flex: 1 },

  stage: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: space.s5,
    height: 420,
    paddingInline: space.s4,
    paddingBlock: space.s4,
    overflow: "hidden",
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderPrimary}`,
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2_5,
    paddingInline: space.s2,
  },
  ask: {
    alignSelf: "flex-end",
    width: "52%",
    height: space.s8,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
  },
  line: { height: 8, borderRadius: radius.pill, backgroundColor: role.bgMuted },
  lineWidth: (width: string) => ({ width }),
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    minHeight: 106,
    padding: space.s2,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: 20,
    backgroundColor: role.bgElevated,
  },
  placeholder: {
    flex: 1,
    paddingInline: space.s2,
    paddingBlockStart: space.s1_5,
    color: role.contentTertiary,
  },
  toolbar: { display: "flex", alignItems: "center", gap: space.s1, minWidth: 0 },
  spacer: { flex: 1 },
  slot: { display: "inline-flex", alignItems: "center", gap: space.s0_5, minWidth: 0 },
});

const LINES = ["92%", "100%", "84%", "61%"];

/** A new chat in a quiet pane: the composer is the only thing with words. */
export function ComposerStage({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div {...props(styles.stage)}>
      <div aria-hidden="true" {...props(styles.transcript)}>
        <span {...props(styles.ask)} />
        {LINES.map((width) => (
          <span key={width} {...props(styles.line, styles.lineWidth(width))} />
        ))}
      </div>
      <div {...props(styles.composer)}>
        <div {...props(text.base, styles.placeholder)}>
          Ask Nyte, or type / for skills and @ for context
        </div>
        <div {...props(styles.toolbar)}>
          <Button iconOnly pill variant="outline" icon="plus" aria-label="Add to message" />
          <span {...props(styles.slot)}>{children}</span>
          <span {...props(styles.spacer)} />
          <Button
            iconOnly
            pill
            variant="solid"
            tone="primary"
            icon="arrow-up"
            aria-label="Send"
            disabled
          />
        </div>
      </div>
    </div>
  );
}

export function ModelGlyph({ option }: { readonly option: DesktopModelOption }): ReactElement {
  return (
    <span aria-hidden="true" {...props(styles.glyph)}>
      <Icon name={modelIcon(option)} size="sm" />
    </span>
  );
}

/** The one row every surface draws for a model: its maker's mark, its name, a quiet fact. */
export function ModelLabel({
  option,
  meta,
}: {
  readonly option: DesktopModelOption;
  readonly meta?: ReactNode;
}): ReactElement {
  return (
    <span {...props(styles.label)}>
      <ModelGlyph option={option} />
      <span {...props(styles.name)}>{option.name}</span>
      {meta !== undefined && <span {...props(text.sm, styles.meta)}>{meta}</span>}
    </span>
  );
}

/** The trigger's face: mark, name, the reasoning level and a bolt when Fast is on. */
export function ChipFace({
  choice,
  detail = true,
}: {
  readonly choice: Choice;
  readonly detail?: boolean;
}): ReactElement {
  return (
    <span {...props(styles.chip)}>
      <ModelGlyph option={choice.current} />
      <span {...props(styles.chipName)}>{choice.current.name}</span>
      {detail && choice.reasons && choice.thinking !== "off" && (
        <span {...props(styles.chipDetail)}>{THINKING_LABELS[choice.thinking]}</span>
      )}
      {detail && choice.fast && (
        <span aria-label="Fast" {...props(styles.chipDetail)}>
          <Icon name="bolt" size="xs" />
        </span>
      )}
      <span aria-hidden="true" {...props(styles.chipChevron)}>
        <Icon name="chevron-down" size="2xs" />
      </span>
    </span>
  );
}

export function chipDescription(choice: Choice): string {
  const parts = [
    choice.current.name,
    choice.reasons ? `${THINKING_LABELS[choice.thinking]} reasoning` : undefined,
    choice.fast ? "Fast" : undefined,
  ].filter((part) => part !== undefined);

  return `Model: ${parts.join(", ")}`;
}

/** Search on top, starred models first, then each provider. Typing filters; Enter picks. */
export function ModelSearch({
  catalog,
  current,
  onPick,
  inputRef,
  initialSearch = "",
  meta,
}: {
  readonly catalog: DesktopCatalog;
  readonly current: DesktopModelOption;
  readonly onPick: (option: DesktopModelOption) => void;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly initialSearch?: string;
  readonly meta?: (option: DesktopModelOption) => ReactNode;
}): ReactElement {
  const [search, setSearch] = useState(initialSearch);
  const groups = pickerGroups(catalog, current, search);

  return (
    <Autocomplete
      inline
      open
      autoHighlight
      items={groups.flatMap((group) => group.options)}
      filter={null}
      value={current}
      inputValue={search}
      itemToStringLabel={(option) => option.name}
      isItemEqualToValue={(option, value) => option.key === value.key}
      onValueChange={(option) => {
        if (option !== null) onPick(option);
      }}
      onInputValueChange={(next, { reason }) => {
        if (reason !== "item-press") setSearch(next);
      }}
    >
      <AutocompleteInput
        variant="inline"
        ref={inputRef}
        aria-label="Search models"
        placeholder="Search models"
      />
      <AutocompleteSeparator />
      <AutocompleteList variant="inline" data-nyte-scrollport>
        {groups.length === 0 && (
          <div {...props(text.sm, styles.empty)}>No models match “{search.trim()}”</div>
        )}
        {groups.map((group) => (
          <AutocompleteGroup key={group.id}>
            <AutocompleteGroupLabel variant="inline">
              {group.id === "favorites" ? "Starred" : group.label}
            </AutocompleteGroupLabel>
            {group.options.map((option) => (
              <AutocompleteItem variant="inline" key={option.key} value={option}>
                <ModelLabel option={option} meta={meta?.(option)} />
              </AutocompleteItem>
            ))}
          </AutocompleteGroup>
        ))}
      </AutocompleteList>
    </Autocomplete>
  );
}

export function contextMeta(option: DesktopModelOption): string {
  return compactTokens(option.contextWindow);
}

/** Every level visible at once, one click to change, no submenu to find. */
export function ReasoningField({
  levels,
  value,
  onChange,
  orientation = "horizontal",
  label = "Reasoning",
}: {
  readonly levels: readonly Thinking[];
  readonly value: Thinking;
  readonly onChange: (level: Thinking) => void;
  readonly orientation?: "horizontal" | "vertical";
  readonly label?: string;
}): ReactElement {
  const id = useId();

  return (
    <div {...props(styles.field)}>
      <span id={id} {...props(text.sm, styles.fieldLabel)}>
        {label}
      </span>
      <ToggleGroup<Thinking>
        aria-labelledby={id}
        orientation={orientation}
        value={[value]}
        onValueChange={(next) => {
          const level = next[0];

          if (level !== undefined) onChange(level);
        }}
        xstyle={styles.segmented}
      >
        {levels.map((level) => (
          <Toggle<Thinking> key={level} value={level} size="xs" xstyle={styles.segment}>
            {THINKING_LABELS[level]}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function FastRow({
  checked,
  onChange,
  label = "Fast",
}: {
  readonly checked: boolean;
  readonly onChange: (fast: boolean) => void;
  readonly label?: string;
}): ReactElement {
  return (
    <label {...props(text.base, styles.switchRow)}>
      <span {...props(styles.switchLabel)}>
        <Icon name="bolt" size="sm" />
        {label}
      </span>
      <Switch label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export const partStyles = create({
  palette: {
    display: "flex",
    flexDirection: "column",
    width: "min(320px, var(--available-width))",
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
    padding: menu.padding,
    overflowY: "clip",
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    flexShrink: 0,
    paddingBlockStart: space.s2,
    paddingInline: space.s1,
    paddingBlockEnd: space.s1,
  },
  rule: {
    flexShrink: 0,
    height: 1,
    marginBlock: space.s1,
    marginInline: `calc(${menu.padding} * -1)`,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  quiet: { color: role.contentSecondary },
  tertiary: { color: role.contentTertiary },
  strong: { fontWeight: type.weightMedium },
});
