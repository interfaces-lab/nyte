A positioning container for the dialog popup that can be made scrollable.
Renders a `<div>` element.

**Viewport Props:**

| Prop      | Type                                                                                               | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: AlertDialog.Viewport.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: AlertDialog.Viewport.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: AlertDialog.Viewport.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Viewport Data Attributes:**

| Attribute               | Type | Description                                                      |
| :---------------------- | :--- | :--------------------------------------------------------------- |
| data-open               | -    | Present when the dialog is open.                                 |
| data-closed             | -    | Present when the dialog is closed.                               |
| data-nested             | -    | Present when the dialog is nested within another dialog.         |
| data-nested-dialog-open | -    | Present when the dialog has other open dialogs nested within it. |
| data-starting-style     | -    | Present when the dialog begins animating in.                     |
| data-ending-style       | -    | Present when the dialog is animating out.                        |
