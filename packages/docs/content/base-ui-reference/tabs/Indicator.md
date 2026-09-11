A visual indicator that can be styled to match the position of the currently active tab.
Renders a `<span>` element.

**Indicator Props:**

| Prop                  | Type                                                                                         | Default | Description                                                                                                                                                                                   |
| :-------------------- | :------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renderBeforeHydration | `boolean`                                                                                    | `false` | Whether to render itself before React hydrates.&#xA;This minimizes the time that the indicator isn't visible after server-side rendering.                                                     |
| className             | `string \| ((state: Tabs.Indicator.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style                 | `React.CSSProperties \| ((state: Tabs.Indicator.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render                | `ReactElement \| ((props: HTMLProps, state: Tabs.Indicator.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Indicator Data Attributes:**

| Attribute                 | Type                                            | Description                                                                   |
| :------------------------ | :---------------------------------------------- | :---------------------------------------------------------------------------- |
| data-orientation          | `'horizontal' \| 'vertical'`                    | Indicates the orientation of the tabs.                                        |
| data-activation-direction | `'left' \| 'right' \| 'up' \| 'down' \| 'none'` | Indicates the direction of the activation (based on the previous active tab). |

**Indicator CSS Variables:**

| Variable              | Type     | Description                                                                                 |
| :-------------------- | :------- | :------------------------------------------------------------------------------------------ |
| `--active-tab-bottom` | `number` | Indicates the distance on the bottom side from the parent's container if the tab is active. |
| `--active-tab-height` | `number` | Indicates the height of the tab if it is active.                                            |
| `--active-tab-left`   | `number` | Indicates the distance on the left side from the parent's container if the tab is active.   |
| `--active-tab-right`  | `number` | Indicates the distance on the right side from the parent's container if the tab is active.  |
| `--active-tab-top`    | `number` | Indicates the distance on the top side from the parent's container if the tab is active.    |
| `--active-tab-width`  | `number` | Indicates the width of the tab if it is active.                                             |
