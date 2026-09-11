Groups several toolbar items or toggles.
Renders a `<div>` element.

**Group Props:**

| Prop      | Type                                                                                        | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| disabled  | `boolean`                                                                                   | `false` | When `true` all toolbar items in the group are disabled.                                                                                                                                      |
| className | `string \| ((state: Toolbar.Group.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Toolbar.Group.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Toolbar.Group.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Group Data Attributes:**

| Attribute        | Type                         | Description                               |
| :--------------- | :--------------------------- | :---------------------------------------- |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the toolbar. |
| data-disabled    | -                            | Present when the group is disabled.       |
