A text input to search for items in the list.
Renders an `<input>` element.

**Input Props:**

| Prop      | Type                                                                                             | Default | Description                                                                                                                                                                                   |
| :-------- | :----------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| disabled  | `boolean`                                                                                        | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className | `string \| ((state: Autocomplete.Input.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Autocomplete.Input.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Input.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Input Data Attributes:**

| Attribute       | Type                                                                               | Description                                                                        |
| :-------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| data-popup-open | -                                                                                  | Present when the corresponding popup is open.                                      |
| data-popup-side | `'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start' \| null` | Indicates which side the corresponding popup is positioned relative to its anchor. |
| data-list-empty | -                                                                                  | Present when the corresponding items list is empty.                                |
| data-pressed    | -                                                                                  | Present when the input is pressed.                                                 |
| data-disabled   | -                                                                                  | Present when the component is disabled.                                            |
| data-readonly   | -                                                                                  | Present when the component is readonly.                                            |
| data-required   | -                                                                                  | Present when the component is required.                                            |
| data-valid      | -                                                                                  | Present when the component is in a valid state (when wrapped in Field.Root).       |
| data-invalid    | -                                                                                  | Present when the component is in an invalid state (when wrapped in Field.Root).    |
| data-dirty      | -                                                                                  | Present when the component's value has changed (when wrapped in Field.Root).       |
| data-touched    | -                                                                                  | Present when the component has been touched (when wrapped in Field.Root).          |
| data-filled     | -                                                                                  | Present when the component has a value (when wrapped in Field.Root).               |
| data-focused    | -                                                                                  | Present when the input is focused (when wrapped in Field.Root).                    |
