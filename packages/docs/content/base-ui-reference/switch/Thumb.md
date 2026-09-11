The movable part of the switch that indicates whether the switch is on or off.
Renders a `<span>`.

**Thumb Props:**

| Prop      | Type                                                                                       | Default | Description                                                                                                                                                                                   |
| :-------- | :----------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Switch.Thumb.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Switch.Thumb.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Switch.Thumb.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Thumb Data Attributes:**

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
