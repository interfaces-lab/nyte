A button that opens the popup.
Renders a `<button>` element.

**Trigger Props:**

| Prop         | Type                                                                                               | Default | Description                                                                                                                                                                                   |
| :----------- | :------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nativeButton | `boolean`                                                                                          | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| disabled     | `boolean`                                                                                          | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className    | `string \| ((state: Autocomplete.Trigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Autocomplete.Trigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Trigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Trigger Data Attributes:**

| Attribute       | Type                                                                               | Description                                                                        |
| :-------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| data-popup-open | -                                                                                  | Present when the corresponding popup is open.                                      |
| data-popup-side | `'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start' \| null` | Indicates which side the corresponding popup is positioned relative to its anchor. |
| data-list-empty | -                                                                                  | Present when the corresponding items list is empty.                                |
| data-pressed    | -                                                                                  | Present when the trigger is pressed.                                               |
| data-disabled   | -                                                                                  | Present when the component is disabled.                                            |
| data-readonly   | -                                                                                  | Present when the component is readonly.                                            |
| data-required   | -                                                                                  | Present when the component is required.                                            |
| data-valid      | -                                                                                  | Present when the component is in a valid state (when wrapped in Field.Root).       |
| data-invalid    | -                                                                                  | Present when the component is in an invalid state (when wrapped in Field.Root).    |
| data-dirty      | -                                                                                  | Present when the component's value has changed (when wrapped in Field.Root).       |
| data-touched    | -                                                                                  | Present when the component has been touched (when wrapped in Field.Root).          |
| data-filled     | -                                                                                  | Present when the component has a value (when wrapped in Field.Root).               |
| data-focused    | -                                                                                  | Present when the trigger is focused (when wrapped in Field.Root).                  |
