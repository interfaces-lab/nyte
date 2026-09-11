A visual separator between items or groups.
Renders a `<div>` element.

**Separator Props:**

| Prop        | Type                                                                                                 | Default        | Description                                                                                                                                                                                   |
| :---------- | :--------------------------------------------------------------------------------------------------- | :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orientation | `Orientation`                                                                                        | `'horizontal'` | The orientation of the separator.                                                                                                                                                             |
| className   | `string \| ((state: Autocomplete.Separator.State) => string \| undefined)`                           | -              | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Autocomplete.Separator.State) => React.CSSProperties \| undefined)` | -              | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render      | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Separator.State) => ReactElement)`          | -              | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
