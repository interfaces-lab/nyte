A custom element to display instead of the native cursor while using the scrub area.
Renders a `<span>` element.

This component uses the [Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API), which may prompt the browser to display a related notification. It is disabled
in Safari to avoid a layout shift that this notification causes there.

**ScrubAreaCursor Props:**

| Prop      | Type                                                                                                      | Default | Description                                                                                                                                                                                   |
| :-------- | :-------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: NumberField.ScrubAreaCursor.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: NumberField.ScrubAreaCursor.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: NumberField.ScrubAreaCursor.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**ScrubAreaCursor Data Attributes:**

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
