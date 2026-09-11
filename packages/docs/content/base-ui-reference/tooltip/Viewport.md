A viewport for displaying content transitions.
This component is only required if one popup can be opened by multiple triggers, its content
changes based on the trigger, and switching between them is animated.
Renders a `<div>` element.

**Viewport Props:**

| Prop      | Type                                                                                           | Default | Description                                                                                                                                                                                   |
| :-------- | :--------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| children  | `React.ReactNode`                                                                              | -       | The content to render inside the transition container.                                                                                                                                        |
| className | `string \| ((state: Tooltip.Viewport.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Tooltip.Viewport.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Tooltip.Viewport.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Viewport Data Attributes:**

| Attribute                 | Type                                                       | Description                                                                                                                                                                                                                        |
| :------------------------ | :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data-activation-direction | `` `${'left' \| 'right' \| ''} ${'down' \| 'up' \| ''}` `` | Indicates the direction from which the popup was activated.&#xA;This can be used to create directional animations based on how the popup was triggered.&#xA;Contains space-separated values for both horizontal and vertical axes. |
| data-current              | -                                                          | Applied to the direct child of the viewport when no transitions are present or the new content when it's entering.                                                                                                                 |
| data-instant              | `'delay' \| 'dismiss' \| 'focus'`                          | Present if animations should be instant.                                                                                                                                                                                           |
| data-previous             | -                                                          | Applied to the direct child of the viewport that contains the exiting content when transitions are present.                                                                                                                        |
| data-transitioning        | -                                                          | Indicates that the viewport is currently transitioning between old and new content.                                                                                                                                                |

**Viewport CSS Variables:**

| Variable         | Type | Description                                                                                                                                                                                                                                                           |
| :--------------- | :--- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--popup-height` | ``   | The height of the parent popup.&#xA;This variable is placed on the 'previous' container and stores the height of the popup when the previous content was rendered.&#xA;It can be used to freeze the dimensions of the popup when animating between different content. |
| `--popup-width`  | ``   | The width of the parent popup.&#xA;This variable is placed on the 'previous' container and stores the width of the popup when the previous content was rendered.&#xA;It can be used to freeze the dimensions of the popup when animating between different content.   |
