A button to remove a chip.
Renders a `<button>` element.

**ChipRemove Props:**

| Prop         | Type                                                                                              | Default | Description                                                                                                                                                                                   |
| :----------- | :------------------------------------------------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nativeButton | `boolean`                                                                                         | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| className    | `string \| ((state: Combobox.ChipRemove.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Combobox.ChipRemove.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render       | `ReactElement \| ((props: HTMLProps, state: Combobox.ChipRemove.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
