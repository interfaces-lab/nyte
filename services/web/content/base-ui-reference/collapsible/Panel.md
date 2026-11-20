A panel with the collapsible contents.
Renders a `<div>` element.

**Panel Props:**

| Prop             | Type                                                                                            | Default | Description                                                                                                                                                                                                 |
| :--------------- | :---------------------------------------------------------------------------------------------- | :------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hiddenUntilFound | `boolean`                                                                                       | `false` | Allows the browser's built-in page search to find and expand the panel contents. Overrides the `keepMounted` prop and uses `hidden="until-found"`&#xA;to hide the element without removing it from the DOM. |
| className        | `string \| ((state: Collapsible.Panel.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                                    |
| style            | `React.CSSProperties \| ((state: Collapsible.Panel.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                                 |
| keepMounted      | `boolean`                                                                                       | `false` | Whether to keep the element in the DOM while the panel is hidden.&#xA;This prop is ignored when `hiddenUntilFound` is used.                                                                                 |
| render           | `ReactElement \| ((props: HTMLProps, state: Collapsible.Panel.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render.               |

**Panel Data Attributes:**

| Attribute           | Type | Description                                   |
| :------------------ | :--- | :-------------------------------------------- |
| data-open           | -    | Present when the collapsible panel is open.   |
| data-closed         | -    | Present when the collapsible panel is closed. |
| data-starting-style | -    | Present when the panel begins animating in.   |
| data-ending-style   | -    | Present when the panel is animating out.      |

**Panel CSS Variables:**

| Variable                     | Type     | Description                     |
| :--------------------------- | :------- | :------------------------------ |
| `--collapsible-panel-height` | `number` | The collapsible panel's height. |
| `--collapsible-panel-width`  | `number` | The collapsible panel's width.  |
