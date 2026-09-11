A panel displayed when the corresponding tab is active.
Renders a `<div>` element.

**Panel Props:**

| Prop        | Type                                                                                     | Default | Description                                                                                                                                                                                   |
| :---------- | :--------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| value\*     | `Tabs.Tab.Value`                                                                         | -       | The value of the TabPanel. It will be shown when the Tab with the corresponding value is active.                                                                                              |
| className   | `string \| ((state: Tabs.Panel.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style       | `React.CSSProperties \| ((state: Tabs.Panel.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted | `boolean`                                                                                | `false` | Whether to keep the HTML element in the DOM while the panel is hidden.                                                                                                                        |
| render      | `ReactElement \| ((props: HTMLProps, state: Tabs.Panel.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Panel Data Attributes:**

| Attribute                 | Type                                            | Description                                                                   |
| :------------------------ | :---------------------------------------------- | :---------------------------------------------------------------------------- |
| data-orientation          | `'horizontal' \| 'vertical'`                    | Indicates the orientation of the tabs.                                        |
| data-activation-direction | `'left' \| 'right' \| 'up' \| 'down' \| 'none'` | Indicates the direction of the activation (based on the previous active tab). |
| data-hidden               | -                                               | Present when the panel is hidden.                                             |
| data-index                | -                                               | Indicates the index of the tab panel.                                         |
| data-starting-style       | -                                               | Present when the panel begins animating in.                                   |
| data-ending-style         | -                                               | Present when the panel is animating out.                                      |
