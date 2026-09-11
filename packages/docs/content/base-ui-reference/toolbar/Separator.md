A separator element accessible to screen readers.
Renders a `<div>` element.

**Separator Props:**

| Prop        | Type                                                                                            | Default | Description                                                                                                                                                                                   |
| :---------- | :---------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orientation | `Orientation`                                                                                   | -       | The orientation of the separator. Defaults to the opposite of the toolbar's&#xA;orientation, so a horizontal toolbar renders vertical separators.                                             |
| className   | `string \| ((state: Toolbar.Separator.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Toolbar.Separator.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render      | `ReactElement \| ((props: HTMLProps, state: Toolbar.Separator.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Separator Data Attributes:**

| Attribute        | Type                         | Description                                                                        |
| :--------------- | :--------------------------- | :--------------------------------------------------------------------------------- |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the separator, which is perpendicular to the toolbar. |
