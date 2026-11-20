Groups all parts of the collapsible.
Renders a `<div>` element.

**Root Props:**

| Prop         | Type                                                                                           | Default | Description                                                                                                                                                                                   |
| :----------- | :--------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| defaultOpen  | `boolean`                                                                                      | `false` | Whether the collapsible panel is initially open. To render a controlled collapsible, use the `open` prop instead.                                                                             |
| open         | `boolean`                                                                                      | -       | Whether the collapsible panel is currently open. To render an uncontrolled collapsible, use the `defaultOpen` prop instead.                                                                   |
| onOpenChange | `((open: boolean, eventDetails: Collapsible.Root.ChangeEventDetails) => void)`                 | -       | Event handler called when the panel is opened or closed.                                                                                                                                      |
| disabled     | `boolean`                                                                                      | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className    | `string \| ((state: Collapsible.Root.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Collapsible.Root.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Collapsible.Root.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Root Data Attributes:**

| Attribute           | Type | Description                                       |
| :------------------ | :--- | :------------------------------------------------ |
| data-open           | -    | Present when the collapsible is open.             |
| data-closed         | -    | Present when the collapsible is closed.           |
| data-starting-style | -    | Present when the collapsible begins animating in. |
| data-ending-style   | -    | Present when the collapsible is animating out.    |
