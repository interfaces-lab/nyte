An individual option in the select popup.
Renders a `<div>` element.

**Item Props:**

| Prop         | Type                                                                                      | Default | Description                                                                                                                                                                                   |
| :----------- | :---------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| label        | `string`                                                                                  | -       | Specifies the text label to use when the item is matched during keyboard text navigation. Defaults to the item text content if not provided.                                                  |
| value        | `any`                                                                                     | `null`  | A unique value that identifies this select item.                                                                                                                                              |
| nativeButton | `boolean`                                                                                 | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                          |
| disabled     | `boolean`                                                                                 | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| children     | `React.ReactNode`                                                                         | -       | -                                                                                                                                                                                             |
| className    | `string \| ((state: Select.Item.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Select.Item.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Select.Item.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Item Data Attributes:**

| Attribute        | Type | Description                                  |
| :--------------- | :--- | :------------------------------------------- |
| data-selected    | -    | Present when the select item is selected.    |
| data-highlighted | -    | Present when the select item is highlighted. |
| data-disabled    | -    | Present when the select item is disabled.    |
