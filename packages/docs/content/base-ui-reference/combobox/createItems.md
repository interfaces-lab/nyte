Creates a collection for the root's `items` prop. Values and labels are derived on first use.

Accepts either a flat item array or an array of groups. The `getValue` and `getLabel` accessors
receive items, not groups.

Items cannot have an `items` array property because they would be interpreted as groups.
Rename that field or cast the data when the runtime values are known not to contain arrays.

The data must not contain nullish entries: remove them before creating the collection, as for
the root's `items` prop.

Create static collections at module scope. Wrap dynamic collections in `React.useMemo()` keyed
by their data.

**Parameters:**

| Parameter | Type                                                       | Default | Description                                                                 |
| :-------- | :--------------------------------------------------------- | :------ | :-------------------------------------------------------------------------- |
| data      | `ComboboxItemsData<Item> \| undefined`                     | -       | The flat or grouped source items, or `undefined` while they are loading.    |
| options   | `CreateComboboxItemsOptions<Item, ComboboxPrimitiveValue>` | -       | Functions that derive each source item's selection value and display label. |

**Return Value:**

A collection whose selection value is the `getValue` accessor's return value.

```tsx
type ReturnValue = ComboboxItemCollection<Item, ComboboxPrimitiveValue>;
```
