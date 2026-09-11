Indicates whether the radio item is selected.
Renders a `<span>` element.

**RadioItemIndicator Props:**

| Prop        | Type                                                                                                  | Default | Description                                                                                                                                                                                   |
| :---------- | :---------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className   | `string \| ((state: Menu.RadioItemIndicator.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Menu.RadioItemIndicator.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                             | `false` | Whether to keep the HTML element in the DOM when the radio item is inactive.                                                                                                                  |
| render      | `ReactElement \| ((props: HTMLProps, state: Menu.RadioItemIndicator.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**RadioItemIndicator Data Attributes:**

| Attribute           | Type | Description                                           |
| :------------------ | :--- | :---------------------------------------------------- |
| data-checked        | -    | Present when the menu radio item is selected.         |
| data-unchecked      | -    | Present when the menu radio item is not selected.     |
| data-disabled       | -    | Present when the menu radio item is disabled.         |
| data-starting-style | -    | Present when the radio indicator begins animating in. |
| data-ending-style   | -    | Present when the radio indicator is animating out.    |
