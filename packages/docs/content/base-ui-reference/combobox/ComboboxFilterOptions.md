```typescript
type ComboboxFilterOptions = {
  /**
   * Whether the combobox is in multiple selection mode.
   * @default false
   */
  multiple?: boolean;
  /**
   * The current value of the combobox, used to keep every item visible while the query still
   * matches the selection.
   */
  value?: any;
  /**
   * The locale to use for string comparison.
   * Defaults to the user's runtime locale.
   */
  locale?: Intl.LocalesArgument;
};
```
