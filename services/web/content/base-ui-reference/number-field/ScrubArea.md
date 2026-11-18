An interactive area where the user can click and drag to change the field value.
Renders a `<span>` element.

**ScrubArea Props:**

| Prop             | Type                                                                                                | Default        | Description                                                                                                                                                                                   |
| :--------------- | :-------------------------------------------------------------------------------------------------- | :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| direction        | `'horizontal' \| 'vertical'`                                                                        | `'horizontal'` | Cursor movement direction in the scrub area.                                                                                                                                                  |
| pixelSensitivity | `number`                                                                                            | `2`            | Determines how many pixels the cursor must move before the value changes.&#xA;A higher value will make scrubbing less sensitive.                                                              |
| teleportDistance | `number`                                                                                            | -              | If specified, determines the distance that the cursor may move from the center&#xA;of the scrub area before it will loop back around.                                                         |
| className        | `string \| ((state: NumberField.ScrubArea.State) => string \| undefined)`                           | -              | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style            | `React.CSSProperties \| ((state: NumberField.ScrubArea.State) => React.CSSProperties \| undefined)` | -              | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render           | `ReactElement \| ((props: HTMLProps, state: NumberField.ScrubArea.State) => ReactElement)`          | -              | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**ScrubArea Data Attributes:**

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
