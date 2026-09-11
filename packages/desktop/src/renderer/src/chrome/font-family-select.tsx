/** Searchable font family picker. Theme stays on SettingsSelect. */
import { Autocomplete } from "@nyte-ai/ui/autocomplete";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import { settingsPatterns as styles } from "../theme/settings-patterns.stylex.ts";
import { selectedFontOption, type FontSelectGroup } from "./font-select-groups.ts";
import type { SettingsSelectOption } from "./settings-controls.tsx";

const FONT_SELECT_COLLISION: NonNullable<Autocomplete.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

export function FontFamilySelect<T extends string>({
  label,
  value,
  groups,
  disabled = false,
  loading = false,
  onValueChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly groups: readonly FontSelectGroup<T>[];
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onValueChange: (value: T) => void;
}): ReactElement {
  const [search, setSearch] = useState("");
  const selected = selectedFontOption(groups, value);

  return (
    <Autocomplete.Root
      items={groups}
      value={search}
      disabled={disabled}
      autoHighlight
      onValueChange={setSearch}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSearch("");
      }}
    >
      <Autocomplete.Trigger
        type="button"
        aria-label={label}
        {...stylex.props(styles.selectTrigger, styles.selectTriggerWide, focus.ring)}
      >
        <span
          style={
            selected?.fontFamily === undefined ? undefined : { fontFamily: selected.fontFamily }
          }
          {...stylex.props(styles.selectValue)}
        >
          {selected?.label ?? value}
        </span>
        <span {...stylex.props(styles.selectIcon)}>
          <Icon name="chevron-down" size={11} />
        </span>
      </Autocomplete.Trigger>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={FONT_SELECT_COLLISION}
          {...stylex.props(styles.selectPositioner)}
        >
          <Autocomplete.Popup {...stylex.props(styles.selectPopup, styles.fontSelectPopup)}>
            <label {...stylex.props(styles.fontSelectSearch)}>
              <Autocomplete.Input
                aria-label="Search fonts"
                placeholder="Search fonts"
                {...stylex.props(styles.fontSelectSearchInput)}
              />
            </label>
            <Autocomplete.Status {...stylex.props(loading && styles.fontSelectEmpty)}>
              {loading ? "Loading fonts..." : null}
            </Autocomplete.Status>
            <Autocomplete.List data-nyte-scrollport {...stylex.props(styles.fontSelectList)}>
              {(group: FontSelectGroup<T>, index: number) => (
                <Autocomplete.Group key={group.id} items={group.items}>
                  {group.title !== undefined && (
                    <>
                      {index > 0 && (
                        <Autocomplete.Separator {...stylex.props(styles.fontSelectSeparator)} />
                      )}
                      <Autocomplete.GroupLabel {...stylex.props(styles.fontSelectGroupLabel)}>
                        {group.title}
                      </Autocomplete.GroupLabel>
                    </>
                  )}
                  <Autocomplete.Collection>
                    {(option: SettingsSelectOption<T>) => (
                      <Autocomplete.Item
                        key={option.value}
                        value={option}
                        {...stylex.props(styles.selectItem, styles.fontSelectItem)}
                        onClick={() => {
                          onValueChange(option.value);
                        }}
                      >
                        <span
                          style={
                            option.fontFamily === undefined
                              ? undefined
                              : { fontFamily: option.fontFamily }
                          }
                          {...stylex.props(styles.selectItemText)}
                        >
                          {option.label}
                        </span>
                        <span aria-hidden="true" {...stylex.props(styles.selectItemIndicator)}>
                          {option.value === value ? <Icon name="checkmark" size={11} /> : null}
                        </span>
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
            <Autocomplete.Empty {...stylex.props(styles.fontSelectEmpty)}>
              No matching fonts
            </Autocomplete.Empty>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
