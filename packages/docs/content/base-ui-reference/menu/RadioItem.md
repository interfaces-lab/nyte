A menu item that works like a radio button in a given group.
Renders a `<div>` element.

**RadioItem Props:**

| Prop         | Type                                                                                         | Default | Description                                                                                                                                                                                   |
| :----------- | :------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| label        | `string`                                                                                     | -       | Overrides the text label to use when the item is matched during keyboard text navigation.                                                                                                     |
| value\*      | `any`                                                                                        | -       | Value of the radio item.&#xA;This is the value that will be set in the Menu.RadioGroup when the item is selected.                                                                             |
| onClick      | `((event: BaseUIEvent<React.MouseEvent<HTMLDivElement, MouseEvent>>) => void)`               | -       | The click handler for the menu item.                                                                                                                                                          |
| closeOnClick | `boolean`                                                                                    | `false` | Whether to close the menu when the item is clicked.                                                                                                                                           |
| nativeButton | `boolean`                                                                                    | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                          |
| disabled     | `boolean`                                                                                    | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className    | `string \| ((state: Menu.RadioItem.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Menu.RadioItem.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Menu.RadioItem.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**RadioItem Data Attributes:**

| Attribute        | Type | Description                                       |
| :--------------- | :--- | :------------------------------------------------ |
| data-checked     | -    | Present when the menu radio item is selected.     |
| data-unchecked   | -    | Present when the menu radio item is not selected. |
| data-highlighted | -    | Present when the menu radio item is highlighted.  |
| data-disabled    | -    | Present when the menu radio item is disabled.     |
