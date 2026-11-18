An individual item in the list.
Renders a `<div>` element.

**Item Props:**

| Prop         | Type                                                                                            | Default | Description                                                                                                                                                                                                                             |
| :----------- | :---------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| value        | `any`                                                                                           | `null`  | A unique value that identifies this item.                                                                                                                                                                                               |
| onClick      | `((event: BaseUIEvent<React.MouseEvent<HTMLDivElement, MouseEvent>>) => void)`                  | -       | An optional click handler for the item when selected.&#xA;It fires when clicking the item with the pointer, as well as when pressing `Enter` with the keyboard if the item is highlighted when the `Input` or `List` element has focus. |
| index        | `number`                                                                                        | -       | The index of the item in the list. Improves performance when specified by avoiding the need to calculate the index automatically from the DOM.                                                                                          |
| nativeButton | `boolean`                                                                                       | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                                                                    |
| disabled     | `boolean`                                                                                       | `false` | Whether the component should ignore user interaction.                                                                                                                                                                                   |
| children     | `React.ReactNode`                                                                               | -       | -                                                                                                                                                                                                                                       |
| className    | `string \| ((state: Autocomplete.Item.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                                                                |
| style        | `React.CSSProperties \| ((state: Autocomplete.Item.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                                                             |
| render       | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Item.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render.                                           |

**Item Data Attributes:**

| Attribute        | Type | Description                           |
| :--------------- | :--- | :------------------------------------ |
| data-highlighted | -    | Present when the item is highlighted. |
| data-disabled    | -    | Present when the item is disabled.    |
