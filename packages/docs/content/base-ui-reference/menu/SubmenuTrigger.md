A menu item that opens a submenu.
Renders a `<div>` element.

**SubmenuTrigger Props:**

| Prop         | Type                                                                                              | Default | Description                                                                                                                                                                                   |
| :----------- | :------------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| label        | `string`                                                                                          | -       | Overrides the text label to use when the item is matched during keyboard text navigation.                                                                                                     |
| onClick      | `((event: BaseUIEvent<React.MouseEvent<HTMLDivElement, MouseEvent>>) => void)`                    | -       | -                                                                                                                                                                                             |
| nativeButton | `boolean`                                                                                         | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                          |
| disabled     | `boolean`                                                                                         | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| openOnHover  | `boolean`                                                                                         | `true`  | Whether the menu should also open when the trigger is hovered.                                                                                                                                |
| delay        | `number`                                                                                          | `100`   | How long to wait before the menu may be opened on hover. Specified in milliseconds. Requires the `openOnHover` prop.                                                                          |
| closeDelay   | `number`                                                                                          | `0`     | How long to wait before closing the menu that was opened on hover.&#xA;Specified in milliseconds. Requires the `openOnHover` prop.                                                            |
| className    | `string \| ((state: Menu.SubmenuTrigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Menu.SubmenuTrigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Menu.SubmenuTrigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**SubmenuTrigger Data Attributes:**

| Attribute        | Type | Description                                      |
| :--------------- | :--- | :----------------------------------------------- |
| data-popup-open  | -    | Present when the corresponding submenu is open.  |
| data-highlighted | -    | Present when the submenu trigger is highlighted. |
| data-disabled    | -    | Present when the submenu trigger is disabled.    |
