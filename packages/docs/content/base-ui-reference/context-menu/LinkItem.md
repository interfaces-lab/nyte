A link in the menu that can be used to navigate to a different page or section.
Renders an `<a>` element.

**LinkItem Props:**

| Prop         | Type                                                                                                                                                                      | Default | Description                                                                                                                                                                                   |
| :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| label        | `string`                                                                                                                                                                  | -       | Overrides the text label to use when the item is matched during keyboard text navigation.                                                                                                     |
| closeOnClick | `boolean`                                                                                                                                                                 | `false` | Whether to close the menu when the item is clicked.                                                                                                                                           |
| className    | `string \| ((state: ContextMenu.LinkItem.State) => string \| undefined)`                                                                                                  | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: ContextMenu.LinkItem.State) => React.CSSProperties \| undefined)`                                                                        | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>, state: ContextMenu.LinkItem.State) => ReactElement)` | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**LinkItem Data Attributes:**

| Attribute        | Type | Description                           |
| :--------------- | :--- | :------------------------------------ |
| data-highlighted | -    | Present when the link is highlighted. |
