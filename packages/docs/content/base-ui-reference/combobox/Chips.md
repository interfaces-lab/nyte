A container for the chips in a multiselectable input.
Renders a `<div>` element.

**Chips Props:**

| Prop      | Type                                                                                         | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Combobox.Chips.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Combobox.Chips.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Combobox.Chips.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
