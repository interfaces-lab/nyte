An individual interactive item in the menu.
Renders a `<div>` element.

**Item Props:**

| Prop         | Type                                                                                           | Default | Description                                                                                                                                                                                   |
| :----------- | :--------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| label        | `string`                                                                                       | -       | Overrides the text label to use when the item is matched during keyboard text navigation.                                                                                                     |
| onClick      | `((event: BaseUIEvent<React.MouseEvent<HTMLDivElement, MouseEvent>>) => void)`                 | -       | The click handler for the menu item.                                                                                                                                                          |
| closeOnClick | `boolean`                                                                                      | `true`  | Whether to close the menu when the item is clicked.                                                                                                                                           |
| nativeButton | `boolean`                                                                                      | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                          |
| disabled     | `boolean`                                                                                      | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className    | `string \| ((state: ContextMenu.Item.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: ContextMenu.Item.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: ContextMenu.Item.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Item Data Attributes:**

| Attribute        | Type | Description                                |
| :--------------- | :--- | :----------------------------------------- |
| data-highlighted | -    | Present when the menu item is highlighted. |
| data-disabled    | -    | Present when the menu item is disabled.    |
