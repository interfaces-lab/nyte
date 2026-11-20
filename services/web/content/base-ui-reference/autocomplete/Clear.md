Clears the value when clicked.
Renders a `<button>` element.

**Clear Props:**

| Prop         | Type                                                                                             | Default | Description                                                                                                                                                                                   |
| :----------- | :----------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nativeButton | `boolean`                                                                                        | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| disabled     | `boolean`                                                                                        | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className    | `string \| ((state: Autocomplete.Clear.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style        | `React.CSSProperties \| ((state: Autocomplete.Clear.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted  | `boolean`                                                                                        | `false` | Whether the component should remain mounted in the DOM when not visible.                                                                                                                      |
| render       | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Clear.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Clear Data Attributes:**

| Attribute           | Type | Description                                   |
| :------------------ | :--- | :-------------------------------------------- |
| data-popup-open     | -    | Present when the corresponding popup is open. |
| data-disabled       | -    | Present when the button is disabled.          |
| data-visible        | -    | Present when the clear button is visible.     |
| data-starting-style | -    | Present when the button begins animating in.  |
| data-ending-style   | -    | Present when the button is animating out.     |
