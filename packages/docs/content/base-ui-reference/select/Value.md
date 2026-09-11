A text label of the currently selected item.
Renders a `<span>` element.

**Value Props:**

| Prop        | Type                                                                                       | Default | Description                                                                                                                                                                                    |
| :---------- | :----------------------------------------------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| placeholder | `React.ReactNode`                                                                          | -       | The placeholder value to display when no value is selected.&#xA;This is overridden by `children` if specified, or by a null item's label in `items`.                                           |
| children    | `React.ReactNode \| ((value: any) => React.ReactNode)`                                     | -       | Accepts a function that returns a `ReactNode` to format the selected value.&#xA;Treat the value as read-only: in `multiple` mode it may be a shared frozen array&#xA;when nothing is selected. |
| className   | `string \| ((state: Select.Value.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                       |
| style       | `React.CSSProperties \| ((state: Select.Value.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                    |
| render      | `ReactElement \| ((props: HTMLProps, state: Select.Value.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render.  |

**`children` Prop Example:**

```tsx
<Select.Value>{(value: string | null) => (value ? labels[value] : 'No value')}</Select.Value>
```

**Value Data Attributes:**

| Attribute        | Type | Description                                   |
| :--------------- | :--- | :-------------------------------------------- |
| data-placeholder | -    | Present when the select doesn't have a value. |
