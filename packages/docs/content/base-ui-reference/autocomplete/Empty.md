Renders its children only when the list is empty.
Requires the `items` prop on the root component.
Announces changes politely to screen readers.
This component's root element must remain mounted in the DOM to announce
changes consistently across screen readers. Avoid hiding or removing the
component itself with `display: none`, `hidden`, `aria-hidden`, or conditional
rendering. Prefer updating or conditionally rendering its children instead.
Renders a `<div>` element.

**Empty Props:**

| Prop      | Type                                                                                             | Default | Description                                                                                                                                                                                   |
| :-------- | :----------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| className | `string \| ((state: Autocomplete.Empty.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Autocomplete.Empty.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Autocomplete.Empty.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
