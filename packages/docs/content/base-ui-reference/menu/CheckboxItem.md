A menu item that toggles a setting on or off.
Renders a `<div>` element.

**CheckboxItem Props:**

| Prop            | Type                                                                                            | Default | Description                                                                                                                                                                                   |
| :-------------- | :---------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| label           | `string`                                                                                        | -       | Overrides the text label to use when the item is matched during keyboard text navigation.                                                                                                     |
| defaultChecked  | `boolean`                                                                                       | `false` | Whether the checkbox item is initially ticked. To render a controlled checkbox item, use the `checked` prop instead.                                                                          |
| checked         | `boolean`                                                                                       | -       | Whether the checkbox item is currently ticked. To render an uncontrolled checkbox item, use the `defaultChecked` prop instead.                                                                |
| onCheckedChange | `((checked: boolean, eventDetails: Menu.CheckboxItem.ChangeEventDetails) => void)`              | -       | Event handler called when the checkbox item is ticked or unticked.                                                                                                                            |
| onClick         | `((event: BaseUIEvent<React.MouseEvent<HTMLDivElement, MouseEvent>>) => void)`                  | -       | The click handler for the menu item.                                                                                                                                                          |
| closeOnClick    | `boolean`                                                                                       | `false` | Whether to close the menu when the item is clicked.                                                                                                                                           |
| nativeButton    | `boolean`                                                                                       | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                          |
| disabled        | `boolean`                                                                                       | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className       | `string \| ((state: Menu.CheckboxItem.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style           | `React.CSSProperties \| ((state: Menu.CheckboxItem.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render          | `ReactElement \| ((props: HTMLProps, state: Menu.CheckboxItem.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**CheckboxItem Data Attributes:**

| Attribute        | Type | Description                                         |
| :--------------- | :--- | :-------------------------------------------------- |
| data-checked     | -    | Present when the menu checkbox item is checked.     |
| data-unchecked   | -    | Present when the menu checkbox item is not checked. |
| data-highlighted | -    | Present when the menu checkbox item is highlighted. |
| data-disabled    | -    | Present when the menu checkbox item is disabled.    |
