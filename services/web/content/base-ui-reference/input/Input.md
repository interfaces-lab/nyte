A native input element that automatically works with [Field](https://base-ui.com/react/components/field).
Renders an `<input>` element.

**Input Props:**

| Prop          | Type                                                                                | Default | Description                                                                                                                                                                                   |
| :------------ | :---------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| defaultValue  | `string \| number \| string[]`                                                      | -       | The default value of the input. Use when uncontrolled.                                                                                                                                        |
| value         | `string \| string[] \| number`                                                      | -       | The value of the input. Use when controlled.                                                                                                                                                  |
| onValueChange | `((value: string, eventDetails: Input.ChangeEventDetails) => void)`                 | -       | Callback fired when the `value` changes. Use when controlled.                                                                                                                                 |
| className     | `string \| ((state: Input.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style         | `React.CSSProperties \| ((state: Input.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render        | `ReactElement \| ((props: HTMLProps, state: Input.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Input Data Attributes:**

| Attribute     | Type | Description                                                                 |
| :------------ | :--- | :-------------------------------------------------------------------------- |
| data-disabled | -    | Present when the input is disabled.                                         |
| data-valid    | -    | Present when the input is in a valid state (when wrapped in Field.Root).    |
| data-invalid  | -    | Present when the input is in an invalid state (when wrapped in Field.Root). |
| data-dirty    | -    | Present when the input's value has changed (when wrapped in Field.Root).    |
| data-touched  | -    | Present when the input has been touched (when wrapped in Field.Root).       |
| data-filled   | -    | Present when the input is filled (when wrapped in Field.Root).              |
| data-focused  | -    | Present when the input is focused (when wrapped in Field.Root).             |
