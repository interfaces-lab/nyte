Groups related menu items with the corresponding label.
Renders a `<div>` element.

**Group Props:**

| Prop      | Type                                                                                     | Default | Description                                                                                                                                                                                   |
| :-------- | :--------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| children  | `React.ReactNode`                                                                        | -       | The content of the component.                                                                                                                                                                 |
| className | `string \| ((state: Menu.Group.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Menu.Group.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Menu.Group.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
