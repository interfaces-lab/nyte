The native input control in the number field.
Renders an `<input>` element.

**Input Props:**

| Prop                 | Type                                                                                                                                                                | Default          | Description                                                                                                                                                                                   |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| aria-roledescription | `string`                                                                                                                                                            | `'Number field'` | A user-friendly description of the input's role for assistive tech. This is a role&#xA;description, not an accessible name — use `Field.Label` or `aria-label` to name the control.           |
| className            | `string \| ((state: NumberField.Input.State) => string \| undefined)`                                                                                               | -                | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style                | `React.CSSProperties \| ((state: NumberField.Input.State) => React.CSSProperties \| undefined)`                                                                     | -                | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render               | `ReactElement \| ((props: React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>, state: NumberField.Input.State) => ReactElement)` | -                | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Input Data Attributes:**

| Attribute      | Type | Description                                                                        |
| :------------- | :--- | :--------------------------------------------------------------------------------- |
| data-disabled  | -    | Present when the number field is disabled.                                         |
| data-readonly  | -    | Present when the number field is readonly.                                         |
| data-required  | -    | Present when the number field is required.                                         |
| data-valid     | -    | Present when the number field is in a valid state (when wrapped in Field.Root).    |
| data-invalid   | -    | Present when the number field is in an invalid state (when wrapped in Field.Root). |
| data-dirty     | -    | Present when the number field's value has changed (when wrapped in Field.Root).    |
| data-touched   | -    | Present when the number field has been touched (when wrapped in Field.Root).       |
| data-filled    | -    | Present when the number field is filled (when wrapped in Field.Root).              |
| data-focused   | -    | Present when the number field is focused (when wrapped in Field.Root).             |
| data-scrubbing | -    | Present while scrubbing.                                                           |
