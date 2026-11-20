A link component.
Renders an `<a>` element.

**Link Props:**

| Prop      | Type                                                                                                                                                              | Default | Description                                                                                                                                                                                   |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Toolbar.Link.State) => string \| undefined)`                                                                                                  | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Toolbar.Link.State) => React.CSSProperties \| undefined)`                                                                        | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>, state: Toolbar.Link.State) => ReactElement)` | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Link Data Attributes:**

| Attribute        | Type                         | Description                               |
| :--------------- | :--------------------------- | :---------------------------------------- |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the toolbar. |
