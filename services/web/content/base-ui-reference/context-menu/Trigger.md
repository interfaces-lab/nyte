An area that opens the menu on right click or long press.
Renders a `<div>` element.

**Trigger Props:**

| Prop      | Type                                                                                              | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: ContextMenu.Trigger.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: ContextMenu.Trigger.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: ContextMenu.Trigger.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Trigger Data Attributes:**

| Attribute       | Type | Description                                          |
| :-------------- | :--- | :--------------------------------------------------- |
| data-popup-open | -    | Present when the corresponding context menu is open. |
| data-pressed    | -    | Present when the corresponding context menu is open. |
