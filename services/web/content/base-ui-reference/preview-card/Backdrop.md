A presentational overlay displayed beneath the popup.
Renders a `<div>` element.

**Backdrop Props:**

| Prop      | Type                                                                                               | Default | Description                                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: PreviewCard.Backdrop.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: PreviewCard.Backdrop.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: PreviewCard.Backdrop.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Backdrop Data Attributes:**

| Attribute           | Type | Description                                        |
| :------------------ | :--- | :------------------------------------------------- |
| data-open           | -    | Present when the preview card is open.             |
| data-closed         | -    | Present when the preview card is closed.           |
| data-starting-style | -    | Present when the preview card begins animating in. |
| data-ending-style   | -    | Present when the preview card is animating out.    |
