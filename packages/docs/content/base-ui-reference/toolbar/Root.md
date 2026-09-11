A container for grouping a set of controls, such as buttons, toggle groups, or menus.
Renders a `<div>` element.

**Root Props:**

| Prop        | Type                                                                                       | Default        | Description                                                                                                                                                                                   |
| :---------- | :----------------------------------------------------------------------------------------- | :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loopFocus   | `boolean`                                                                                  | `true`         | If `true`, using keyboard navigation will wrap focus to the other end of the toolbar once the end is reached.                                                                                 |
| disabled    | `boolean`                                                                                  | -              | -                                                                                                                                                                                             |
| orientation | `Toolbar.Root.Orientation`                                                                 | `'horizontal'` | The orientation of the toolbar.                                                                                                                                                               |
| className   | `string \| ((state: Toolbar.Root.State) => string \| undefined)`                           | -              | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Toolbar.Root.State) => React.CSSProperties \| undefined)` | -              | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render      | `ReactElement \| ((props: HTMLProps, state: Toolbar.Root.State) => ReactElement)`          | -              | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Root Data Attributes:**

| Attribute        | Type                         | Description                               |
| :--------------- | :--------------------------- | :---------------------------------------- |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the toolbar. |
| data-disabled    | -                            | Present when the toolbar is disabled.     |
