A portal element that moves the popup to a different part of the DOM.
By default, the portal element is appended to `<body>`.
Renders a `<div>` element.

**Portal Props:**

| Prop        | Type                                                                                         | Default | Description                                                                                                                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| container   | `HTMLElement \| ShadowRoot \| React.RefObject<HTMLElement \| ShadowRoot \| null> \| null`    | -       | A parent element to render the portal element into.                                                                                                                                           |
| className   | `string \| ((state: Popover.Portal.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Popover.Portal.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                    | `false` | Whether to keep the portal mounted in the DOM while the popup is hidden.                                                                                                                      |
| render      | `ReactElement \| ((props: HTMLProps, state: Popover.Portal.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |
