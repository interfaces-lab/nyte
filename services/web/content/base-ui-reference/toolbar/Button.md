A button that can be used as-is or as a trigger for other components.
Renders a `<button>` element.

**Button Props:**

| Prop                  | Type                                                                                         | Default | Description                                                                                                                                                                                   |
| :-------------------- | :------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| focusableWhenDisabled | `boolean`                                                                                    | `true`  | When `true` the item remains focusable when disabled.                                                                                                                                         |
| nativeButton          | `boolean`                                                                                    | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| disabled              | `boolean`                                                                                    | `false` | When `true` the item is disabled.                                                                                                                                                             |
| className             | `string \| ((state: Toolbar.Button.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style                 | `React.CSSProperties \| ((state: Toolbar.Button.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render                | `ReactElement \| ((props: HTMLProps, state: Toolbar.Button.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Button Data Attributes:**

| Attribute        | Type                         | Description                                              |
| :--------------- | :--------------------------- | :------------------------------------------------------- |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the toolbar.                |
| data-disabled    | -                            | Present when the button is disabled.                     |
| data-focusable   | -                            | Present when the button remains focusable when disabled. |
