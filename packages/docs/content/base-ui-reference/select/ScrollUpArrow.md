An element that scrolls the select popup up when hovered. Does not render when using touch input.
Renders a `<div>` element.

**ScrollUpArrow Props:**

| Prop        | Type                                                                                               | Default | Description                                                                                                                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className   | `string \| ((state: Select.ScrollUpArrow.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Select.ScrollUpArrow.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                          | `false` | Whether to keep the HTML element in the DOM while the select popup is not scrollable.                                                                                                         |
| render      | `ReactElement \| ((props: HTMLProps, state: Select.ScrollUpArrow.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**ScrollUpArrow Data Attributes:**

| Attribute           | Type                                                                                 | Description                                                           |
| :------------------ | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| data-direction      | `'up'`                                                                               | Indicates the direction of the scroll arrow.                          |
| data-side           | `'none' \| 'top' \| 'bottom' \| 'left' \| 'right' \| 'inline-end' \| 'inline-start'` | Indicates which side the popup is positioned relative to the trigger. |
| data-visible        | -                                                                                    | Present when the scroll arrow is visible.                             |
| data-starting-style | -                                                                                    | Present when the scroll arrow begins animating in.                    |
| data-ending-style   | -                                                                                    | Present when the scroll arrow is animating out.                       |
