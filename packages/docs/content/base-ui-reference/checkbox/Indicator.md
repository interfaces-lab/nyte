Indicates whether the checkbox is ticked.
Renders a `<span>` element.

**Indicator Props:**

| Prop        | Type                                                                                             | Default | Description                                                                                                                                                                                   |
| :---------- | :----------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className   | `string \| ((state: Checkbox.Indicator.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Checkbox.Indicator.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                        | `false` | Whether to keep the element in the DOM when the checkbox is not checked.                                                                                                                      |
| render      | `ReactElement \| ((props: HTMLProps, state: Checkbox.Indicator.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Indicator Data Attributes:**

| Attribute           | Type | Description                                                                    |
| :------------------ | :--- | :----------------------------------------------------------------------------- |
| data-checked        | -    | Present when the checkbox is checked.                                          |
| data-unchecked      | -    | Present when the checkbox is not checked.                                      |
| data-disabled       | -    | Present when the checkbox is disabled.                                         |
| data-readonly       | -    | Present when the checkbox is readonly.                                         |
| data-required       | -    | Present when the checkbox is required.                                         |
| data-valid          | -    | Present when the checkbox is in a valid state (when wrapped in Field.Root).    |
| data-invalid        | -    | Present when the checkbox is in an invalid state (when wrapped in Field.Root). |
| data-dirty          | -    | Present when the checkbox's value has changed (when wrapped in Field.Root).    |
| data-touched        | -    | Present when the checkbox has been touched (when wrapped in Field.Root).       |
| data-filled         | -    | Present when the checkbox is checked (when wrapped in Field.Root).             |
| data-focused        | -    | Present when the checkbox is focused (when wrapped in Field.Root).             |
| data-indeterminate  | -    | Present when the checkbox is in an indeterminate state.                        |
| data-starting-style | -    | Present when the checkbox indicator begins animating in.                       |
| data-ending-style   | -    | Present when the checkbox indicator is animating out.                          |
