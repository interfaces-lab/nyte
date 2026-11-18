A button that opens the alert dialog.
Renders a `<button>` element.

**Trigger Props:**

| Prop         | Type                                                                                              | Default | Description                                                                                                                                                                                            |
| :----------- | :------------------------------------------------------------------------------------------------ | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handle       | `AlertDialog.Handle<Payload>`                                                                     | -       | A handle to associate the trigger with an alert dialog.&#xA;Can be created with the AlertDialog.createHandle() method.                                                                                 |
| nativeButton | `boolean`                                                                                         | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).              |
| payload      | `Payload`                                                                                         | -       | A payload to pass to the dialog when it is opened.                                                                                                                                                     |
| id           | `string`                                                                                          | -       | ID of the trigger. In addition to being forwarded to the rendered element,&#xA;it is also used to specify the active trigger for the dialog in controlled mode (with the DialogRoot `triggerId` prop). |
| className    | `string \| ((state: AlertDialog.Trigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                               |
| style        | `React.CSSProperties \| ((state: AlertDialog.Trigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                            |
| render       | `ReactElement \| ((props: HTMLProps, state: AlertDialog.Trigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render.          |

**Trigger Data Attributes:**

| Attribute       | Type | Description                                          |
| :-------------- | :--- | :--------------------------------------------------- |
| data-popup-open | -    | Present when the corresponding alert dialog is open. |
| data-disabled   | -    | Present when the trigger is disabled.                |
