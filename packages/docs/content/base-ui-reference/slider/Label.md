An accessible label that is automatically associated with the slider thumbs.
Renders a `<div>` element.

**Label Props:**

| Prop      | Type                                                                                      | Default | Description                                                                                                                                                                                   |
| :-------- | :---------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Slider.Root.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Slider.Root.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Slider.Root.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
