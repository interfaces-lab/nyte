```typescript
type CreateComboboxItemsOptions<
  Item,
  Value extends ComboboxPrimitiveValue = ComboboxPrimitiveValue,
> = {
  /**
   * Projects an item to the primitive value that identifies it, used as the item's
   * selection value.
   *
   * `null` and `undefined` are reserved for no selection, and each item must derive a unique
   * value. Prefer stable IDs from your application data.
   */
  getValue: (item: Item) => Value;
  /**
   * Projects an item to the label string that represents it in the input and when matching the
   * typed query. The root's `itemToStringLabel` prop is the fallback for values whose item is in
   * neither the data nor the current `filteredItems`.
   */
  getLabel: (item: Item) => string;
};
```

## External Types
