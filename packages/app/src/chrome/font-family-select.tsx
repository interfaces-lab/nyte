/** Searchable font family picker. Theme stays on Select. */
import { Autocomplete, type AutocompletePositionerProps } from "@nyte-ai/ui/autocomplete";
import { useState } from "react";
import type { ReactElement } from "react";
import { selectedFontOption, type FontSelectGroup } from "./font-select-groups.ts";
import type { SelectOption } from "@nyte-ai/ui/select";

const FONT_SELECT_COLLISION: NonNullable<AutocompletePositionerProps["collisionAvoidance"]> = {
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
        style={selected?.fontFamily === undefined ? undefined : { fontFamily: selected.fontFamily }}
      >
        {selected?.label ?? value}
      </Autocomplete.Trigger>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          collisionAvoidance={FONT_SELECT_COLLISION}
        >
          <Autocomplete.Popup>
            <Autocomplete.Input aria-label="Search fonts" placeholder="Search fonts" />
            <Autocomplete.Status>{loading ? "Loading fonts..." : null}</Autocomplete.Status>
            <Autocomplete.List data-nyte-scrollport>
              {(group: FontSelectGroup<T>, index: number) => (
                <Autocomplete.Group key={group.id} items={group.items}>
                  {group.title !== undefined && (
                    <>
                      {index > 0 && <Autocomplete.Separator />}
                      <Autocomplete.GroupLabel>{group.title}</Autocomplete.GroupLabel>
                    </>
                  )}
                  <Autocomplete.Collection>
                    {(option: SelectOption<T>) => (
                      <Autocomplete.Item
                        key={option.value}
                        value={option}
                        selected={option.value === value}
                        style={
                          option.fontFamily === undefined
                            ? undefined
                            : { fontFamily: option.fontFamily }
                        }
                        onClick={() => {
                          onValueChange(option.value);
                        }}
                      >
                        {option.label}
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
            <Autocomplete.Empty>No matching fonts</Autocomplete.Empty>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
