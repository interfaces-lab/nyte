Indicates whether the select item is selected.
Renders a `<span>` element.

**ItemIndicator Props:**

| Prop        | Type                                                                                               | Default | Description                                                                                                                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| children    | `React.ReactNode`                                                                                  | -       | -                                                                                                                                                                                             |
| className   | `string \| ((state: Select.ItemIndicator.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Select.ItemIndicator.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                          | -       | Whether to keep the HTML element in the DOM when the item is not selected.                                                                                                                    |
| render      | `ReactElement \| ((props: HTMLProps, state: Select.ItemIndicator.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**ItemIndicator Data Attributes:**

| Attribute           | Type | Description                                     |
| :------------------ | :--- | :---------------------------------------------- |
| data-starting-style | -    | Present when the indicator begins animating in. |
| data-ending-style   | -    | Present when the indicator is animating out.    |
