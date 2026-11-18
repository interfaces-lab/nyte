Displays an element positioned against the select popup anchor.
Renders a `<div>` element.

**Arrow Props:**

| Prop      | Type                                                                                       | Default | Description                                                                                                                                                                                   |
| :-------- | :----------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Select.Arrow.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Select.Arrow.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Select.Arrow.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Arrow Data Attributes:**

| Attribute       | Type                                                                                 | Description                                                           |
| :-------------- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| data-open       | -                                                                                    | Present when the select popup is open.                                |
| data-closed     | -                                                                                    | Present when the select popup is closed.                              |
| data-uncentered | -                                                                                    | Present when the select arrow is uncentered.                          |
| data-align      | `'start' \| 'center' \| 'end'`                                                       | Indicates how the popup is aligned relative to specified side.        |
| data-side       | `'none' \| 'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start'` | Indicates which side the popup is positioned relative to the trigger. |
