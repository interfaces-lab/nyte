A button that opens the popover.
Renders a `<button>` element.

**Trigger Props:**

| Prop         | Type                                                                                          | Default | Description                                                                                                                                                                                               |
| :----------- | :-------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handle       | `Popover.Handle<Payload>`                                                                     | -       | A handle to associate the trigger with a popover.                                                                                                                                                         |
| nativeButton | `boolean`                                                                                     | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).                 |
| payload      | `Payload`                                                                                     | -       | A payload to pass to the popover when it is opened.                                                                                                                                                       |
| openOnHover  | `boolean`                                                                                     | `false` | Whether the popover should also open when the trigger is hovered.                                                                                                                                         |
| delay        | `number`                                                                                      | `300`   | How long to wait before the popover may be opened on hover. Specified in milliseconds. Requires the `openOnHover` prop.                                                                                   |
| closeDelay   | `number`                                                                                      | `0`     | How long to wait before closing the popover that was opened on hover.&#xA;Specified in milliseconds. Requires the `openOnHover` prop.                                                                     |
| id           | `string`                                                                                      | -       | ID of the trigger. In addition to being forwarded to the rendered element,&#xA;it is also used to specify the active trigger for the popover in controlled mode (with the Popover.Root `triggerId` prop). |
| className    | `string \| ((state: Popover.Trigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                                  |
| style        | `React.CSSProperties \| ((state: Popover.Trigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                               |
| render       | `ReactElement \| ((props: HTMLProps, state: Popover.Trigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render.             |

**Trigger Data Attributes:**

| Attribute       | Type | Description                                     |
| :-------------- | :--- | :---------------------------------------------- |
| data-popup-open | -    | Present when the corresponding popover is open. |
| data-pressed    | -    | Present when the trigger is pressed.            |
| data-disabled   | -    | Present when the trigger is disabled.           |
