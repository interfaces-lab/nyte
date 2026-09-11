Represents the switch itself.
Renders a `<span>` element and a hidden `<input>` beside.

**Root Props:**

| Prop            | Type                                                                                      | Default | Description                                                                                                                                                                                   |
| :-------------- | :---------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name            | `string`                                                                                  | -       | Identifies the field when a form is submitted.                                                                                                                                                |
| defaultChecked  | `boolean`                                                                                 | `false` | Whether the switch is initially active. To render a controlled switch, use the `checked` prop instead.                                                                                        |
| checked         | `boolean`                                                                                 | -       | Whether the switch is currently active. To render an uncontrolled switch, use the `defaultChecked` prop instead.                                                                              |
| onCheckedChange | `((checked: boolean, eventDetails: Switch.Root.ChangeEventDetails) => void)`              | -       | Event handler called when the switch is activated or deactivated.                                                                                                                             |
| value           | `string`                                                                                  | -       | The value submitted with the form when the switch is on.&#xA;By default, switch submits the "on" value, matching native checkbox behavior.                                                    |
| form            | `string`                                                                                  | -       | Identifies the form that owns the hidden input.&#xA;Useful when the switch is rendered outside the form.                                                                                      |
| nativeButton    | `boolean`                                                                                 | `false` | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `true` if the rendered element is a native button.                          |
| uncheckedValue  | `string`                                                                                  | -       | The value submitted with the form when the switch is off.&#xA;By default, unchecked switches do not submit any value, matching native checkbox behavior.                                      |
| disabled        | `boolean`                                                                                 | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| readOnly        | `boolean`                                                                                 | `false` | Whether the user should be unable to activate or deactivate the switch.                                                                                                                       |
| required        | `boolean`                                                                                 | `false` | Whether the user must activate the switch before submitting a form.                                                                                                                           |
| inputRef        | `React.Ref<HTMLInputElement>`                                                             | -       | A ref to access the hidden `<input>` element.                                                                                                                                                 |
| id              | `string`                                                                                  | -       | The id of the hidden input element. When `nativeButton` is `true`, the id is applied to the root element.                                                                                     |
| className       | `string \| ((state: Switch.Root.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style           | `React.CSSProperties \| ((state: Switch.Root.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render          | `ReactElement \| ((props: HTMLProps, state: Switch.Root.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Root Data Attributes:**

| Attribute      | Type | Description                                                                  |
| :------------- | :--- | :--------------------------------------------------------------------------- |
| data-checked   | -    | Present when the switch is checked.                                          |
| data-unchecked | -    | Present when the switch is not checked.                                      |
| data-disabled  | -    | Present when the switch is disabled.                                         |
| data-readonly  | -    | Present when the switch is readonly.                                         |
| data-required  | -    | Present when the switch is required.                                         |
| data-valid     | -    | Present when the switch is in a valid state (when wrapped in Field.Root).    |
| data-invalid   | -    | Present when the switch is in an invalid state (when wrapped in Field.Root). |
| data-dirty     | -    | Present when the switch's value has changed (when wrapped in Field.Root).    |
| data-touched   | -    | Present when the switch has been touched (when wrapped in Field.Root).       |
| data-filled    | -    | Present when the switch is active (when wrapped in Field.Root).              |
| data-focused   | -    | Present when the switch is focused (when wrapped in Field.Root).             |
