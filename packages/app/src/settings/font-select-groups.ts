export interface FontOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly fontFamily?: string;
}

export const UI_FONT_CATALOG_TITLE = "All Fonts";

export const CODE_FONT_CATALOG_TITLE = "Monospace";

export interface FontSelectGroup<T extends string> {
  readonly id: "pinned" | "all";
  readonly title?: string;
  readonly items: readonly FontOption<T>[];
}

export function fontSelectGroups<T extends string>(
  builtIn: readonly FontOption<T>[],
  families: readonly string[],
  selectedFamily: string | undefined,
  selectionForFamily: (family: string) => T,
  stack: (selection: T) => string,
  catalogTitle: string,
): readonly FontSelectGroup<T>[] {
  const pinned: FontOption<T>[] = [...builtIn];
  const labels = new Set(pinned.map((option) => option.label.toLocaleLowerCase()));

  if (selectedFamily !== undefined) {
    const normalized = selectedFamily.toLocaleLowerCase();
    const inCatalog = families.some((family) => family.toLocaleLowerCase() === normalized);

    if (!inCatalog && !labels.has(normalized)) {
      labels.add(normalized);
      const value = selectionForFamily(selectedFamily);
      pinned.push({ value, label: selectedFamily, fontFamily: stack(value) });
    }
  }

  const installed: FontOption<T>[] = [];

  for (const family of families) {
    const normalized = family.toLocaleLowerCase();

    if (labels.has(normalized)) continue;
    labels.add(normalized);
    const value = selectionForFamily(family);
    installed.push({ value, label: family, fontFamily: stack(value) });
  }

  if (installed.length === 0) return [{ id: "pinned", items: pinned }];

  return [
    { id: "pinned", items: pinned },
    { id: "all", title: catalogTitle, items: installed },
  ];
}

export function selectedFontOption<T extends string>(
  groups: readonly FontSelectGroup<T>[],
  value: T,
): FontOption<T> | undefined {
  for (const group of groups) {
    const match = group.items.find((option) => option.value === value);

    if (match !== undefined) return match;
  }

  return undefined;
}
