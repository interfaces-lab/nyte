A container for the tooltip contents.
Renders a `<div>` element.

**Popup Props:**

| Prop      | Type                                                                                        | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Tooltip.Popup.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Tooltip.Popup.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Tooltip.Popup.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Popup Data Attributes:**

| Attribute           | Type                                                                       | Description                                                           |
| :------------------ | :------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| data-open           | -                                                                          | Present when the tooltip is open.                                     |
| data-closed         | -                                                                          | Present when the tooltip is closed.                                   |
| data-align          | `'start' \| 'center' \| 'end'`                                             | Indicates how the popup is aligned relative to specified side.        |
| data-instant        | `'delay' \| 'dismiss' \| 'focus'`                                          | Present if animations should be instant.                              |
| data-side           | `'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start'` | Indicates which side the popup is positioned relative to the trigger. |
| data-starting-style | -                                                                          | Present when the tooltip begins animating in.                         |
| data-ending-style   | -                                                                          | Present when the tooltip is animating out.                            |
