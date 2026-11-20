A wrapper for the input and its associated controls.
Renders a `<div>` element.

**InputGroup Props:**

| Prop      | Type                                                                                                  | Default | Description                                                                                                                                                                                   |
| :-------- | :---------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Autocomplete.InputGroup.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Autocomplete.InputGroup.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Autocomplete.InputGroup.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**InputGroup Data Attributes:**

| Attribute       | Type                                                                               | Description                                                                        |
| :-------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| data-popup-open | -                                                                                  | Present when the corresponding popup is open.                                      |
| data-popup-side | `'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start' \| null` | Indicates which side the corresponding popup is positioned relative to its anchor. |
| data-list-empty | -                                                                                  | Present when the corresponding items list is empty.                                |
| data-pressed    | -                                                                                  | Present when the input group is pressed.                                           |
| data-disabled   | -                                                                                  | Present when the component is disabled.                                            |
| data-readonly   | -                                                                                  | Present when the component is readonly.                                            |
| data-valid      | -                                                                                  | Present when the component is in a valid state (when wrapped in Field.Root).       |
| data-invalid    | -                                                                                  | Present when the component is in an invalid state (when wrapped in Field.Root).    |
| data-dirty      | -                                                                                  | Present when the component's value has changed (when wrapped in Field.Root).       |
| data-touched    | -                                                                                  | Present when the component has been touched (when wrapped in Field.Root).          |
| data-filled     | -                                                                                  | Present when the component has a value (when wrapped in Field.Root).               |
| data-focused    | -                                                                                  | Present when the component is focused (when wrapped in Field.Root).                |
