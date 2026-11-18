A search field that filters the menu items.
Requires the menu to be wrapped in `Menu.FilterProvider`.
Renders an `<input>` element.

**Input Props:**

| Prop      | Type                                                                                     | Default | Description                                                                                                                                                                                   |
| :-------- | :--------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Menu.Input.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Menu.Input.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Menu.Input.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Input Data Attributes:**

| Attribute        | Type | Description                                                                                            |
| :--------------- | :--- | :----------------------------------------------------------------------------------------------------- |
| data-highlighted | -    | Present while the input shows its focus ring.&#xA;Cleared when keyboard navigation highlights an item. |
