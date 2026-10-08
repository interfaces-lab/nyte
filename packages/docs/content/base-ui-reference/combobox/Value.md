The current value of the combobox.
Doesn't render its own HTML element.

**Value Props:**

| Prop        | Type                                                           | Default | Description                                                                                                                                                                                    |
| :---------- | :------------------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| placeholder | `React.ReactNode`                                              | -       | The placeholder value to display when no value is selected.&#xA;This is overridden by `children` if specified, or by a null item's label in `items`.                                           |
| children    | `React.ReactNode \| ((selectedValue: any) => React.ReactNode)` | -       | Accepts a function that returns a `ReactNode` to format the selected value.&#xA;Treat the value as read-only: in `multiple` mode it may be a shared frozen array&#xA;when nothing is selected. |
