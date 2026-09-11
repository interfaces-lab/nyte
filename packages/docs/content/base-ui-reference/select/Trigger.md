A button that opens the select popup.
Renders a `<button>` element.

**Trigger Props:**

| Prop         | Type                                                                                         | Default | Description                                                                                                                                                                                   |
| :----------- | :------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nativeButton | `boolean`                                                                                    | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| disabled     | `boolean`                                                                                    | -       | Whether the component should ignore user interaction.                                                                                                                                         |
| children     | `React.ReactNode`                                                                            | -       | -                                                                                                                                                                                             |
| className    | `string \| ((state: Select.Trigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Select.Trigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Select.Trigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Trigger Data Attributes:**

| Attribute        | Type                                                                               | Description                                                                        |
| :--------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| data-popup-open  | -                                                                                  | Present when the corresponding select is open.                                     |
| data-popup-side  | `'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start' \| null` | Indicates which side the corresponding popup is positioned relative to its anchor. |
| data-pressed     | -                                                                                  | Present when the trigger is pressed.                                               |
| data-disabled    | -                                                                                  | Present when the select is disabled.                                               |
| data-readonly    | -                                                                                  | Present when the select is readonly.                                               |
| data-required    | -                                                                                  | Present when the select is required.                                               |
| data-valid       | -                                                                                  | Present when the select is in a valid state (when wrapped in Field.Root).          |
| data-invalid     | -                                                                                  | Present when the select is in an invalid state (when wrapped in Field.Root).       |
| data-dirty       | -                                                                                  | Present when the select's value has changed (when wrapped in Field.Root).          |
| data-touched     | -                                                                                  | Present when the select has been touched (when wrapped in Field.Root).             |
| data-filled      | -                                                                                  | Present when the select has a value (when wrapped in Field.Root).                  |
| data-focused     | -                                                                                  | Present when the select trigger is focused (when wrapped in Field.Root).           |
| data-placeholder | -                                                                                  | Present when the select doesn't have a value.                                      |
