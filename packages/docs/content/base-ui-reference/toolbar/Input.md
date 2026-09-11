A native input element that integrates with Toolbar keyboard navigation.
Renders an `<input>` element.

**Input Props:**

| Prop                  | Type                                                                                        | Default | Description                                                                                                                                                                                   |
| :-------------------- | :------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| defaultValue          | `string \| number \| string[]`                                                              | -       | -                                                                                                                                                                                             |
| focusableWhenDisabled | `boolean`                                                                                   | `true`  | When `true` the item remains focusable when disabled.                                                                                                                                         |
| disabled              | `boolean`                                                                                   | `false` | When `true` the item is disabled.                                                                                                                                                             |
| className             | `string \| ((state: Toolbar.Input.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style                 | `React.CSSProperties \| ((state: Toolbar.Input.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render                | `ReactElement \| ((props: HTMLProps, state: Toolbar.Input.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Input Data Attributes:**

| Attribute        | Type                         | Description                                             |
| :--------------- | :--------------------------- | :------------------------------------------------------ |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the toolbar.               |
| data-disabled    | -                            | Present when the input is disabled.                     |
| data-focusable   | -                            | Present when the input remains focusable when disabled. |
