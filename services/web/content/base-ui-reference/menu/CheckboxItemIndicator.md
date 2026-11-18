Indicates whether the checkbox item is ticked.
Renders a `<span>` element.

**CheckboxItemIndicator Props:**

| Prop        | Type                                                                                                     | Default | Description                                                                                                                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className   | `string \| ((state: Menu.CheckboxItemIndicator.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Menu.CheckboxItemIndicator.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                                | `false` | Whether to keep the HTML element in the DOM when the checkbox item is not checked.                                                                                                            |
| render      | `ReactElement \| ((props: HTMLProps, state: Menu.CheckboxItemIndicator.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**CheckboxItemIndicator Data Attributes:**

| Attribute           | Type | Description                                         |
| :------------------ | :--- | :-------------------------------------------------- |
| data-checked        | -    | Present when the menu checkbox item is checked.     |
| data-unchecked      | -    | Present when the menu checkbox item is not checked. |
| data-disabled       | -    | Present when the menu checkbox item is disabled.    |
| data-starting-style | -    | Present when the indicator begins animating in.     |
| data-ending-style   | -    | Present when the indicator is animating out.        |
