An overlay displayed beneath the popup.
Renders a `<div>` element.

**Backdrop Props:**

| Prop      | Type                                                                                                | Default | Description                                                                                                                                                                                   |
| :-------- | :-------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Autocomplete.Backdrop.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Autocomplete.Backdrop.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Backdrop.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Backdrop Data Attributes:**

| Attribute           | Type | Description                                 |
| :------------------ | :--- | :------------------------------------------ |
| data-open           | -    | Present when the popup is open.             |
| data-closed         | -    | Present when the popup is closed.           |
| data-starting-style | -    | Present when the popup begins animating in. |
| data-ending-style   | -    | Present when the popup is animating out.    |
