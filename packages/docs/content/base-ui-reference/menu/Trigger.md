A button that opens the menu.
Renders a `<button>` element.

**Trigger Props:**

| Prop         | Type                                                                                       | Default | Description                                                                                                                                                                                   |
| :----------- | :----------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handle       | `Menu.Handle<Payload>`                                                                     | -       | A handle to associate the trigger with a menu.                                                                                                                                                |
| nativeButton | `boolean`                                                                                  | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| payload      | `Payload`                                                                                  | -       | A payload to pass to the menu when it is opened.                                                                                                                                              |
| disabled     | `boolean`                                                                                  | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| openOnHover  | `boolean`                                                                                  | -       | Whether the menu should also open when the trigger is hovered.                                                                                                                                |
| delay        | `number`                                                                                   | `100`   | How long to wait before the menu may be opened on hover. Specified in milliseconds. Requires the `openOnHover` prop.                                                                          |
| closeDelay   | `number`                                                                                   | `0`     | How long to wait before closing the menu that was opened on hover.&#xA;Specified in milliseconds. Requires the `openOnHover` prop.                                                            |
| children     | `React.ReactNode`                                                                          | -       | -                                                                                                                                                                                             |
| className    | `string \| ((state: Menu.Trigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Menu.Trigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Menu.Trigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Trigger Data Attributes:**

| Attribute       | Type | Description                                  |
| :-------------- | :--- | :------------------------------------------- |
| data-popup-open | -    | Present when the corresponding menu is open. |
| data-pressed    | -    | Present when the trigger is pressed.         |
| data-disabled   | -    | Present when the trigger is disabled.        |
