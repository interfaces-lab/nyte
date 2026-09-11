Displays an element positioned against the tooltip anchor.
Renders a `<div>` element.

**Arrow Props:**

| Prop      | Type                                                                                        | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Tooltip.Arrow.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Tooltip.Arrow.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Tooltip.Arrow.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Arrow Data Attributes:**

| Attribute       | Type                                                                       | Description                                                           |
| :-------------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| data-open       | -                                                                          | Present when the tooltip is open.                                     |
| data-closed     | -                                                                          | Present when the tooltip is closed.                                   |
| data-uncentered | -                                                                          | Present when the tooltip arrow is uncentered.                         |
| data-align      | `'start' \| 'center' \| 'end'`                                             | Indicates how the popup is aligned relative to specified side.        |
| data-instant    | `'delay' \| 'dismiss' \| 'focus'`                                          | Present if animations should be instant.                              |
| data-side       | `'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start'` | Indicates which side the popup is positioned relative to the trigger. |
