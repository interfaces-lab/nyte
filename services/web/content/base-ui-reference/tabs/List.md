Groups the individual tab buttons.
Renders a `<div>` element.

**List Props:**

| Prop            | Type                                                                                    | Default | Description                                                                                                                                                                                   |
| :-------------- | :-------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activateOnFocus | `boolean`                                                                               | `false` | Whether to automatically change the active tab on arrow key focus.&#xA;Otherwise, tabs will be activated using Enter or Space key press.                                                      |
| loopFocus       | `boolean`                                                                               | `true`  | Whether to loop keyboard focus back to the first item&#xA;when the end of the list is reached while using the arrow keys.                                                                     |
| className       | `string \| ((state: Tabs.List.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style           | `React.CSSProperties \| ((state: Tabs.List.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render          | `ReactElement \| ((props: HTMLProps, state: Tabs.List.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**List Data Attributes:**

| Attribute                 | Type                                            | Description                                                                   |
| :------------------------ | :---------------------------------------------- | :---------------------------------------------------------------------------- |
| data-orientation          | `'horizontal' \| 'vertical'`                    | Indicates the orientation of the tabs.                                        |
| data-activation-direction | `'left' \| 'right' \| 'up' \| 'down' \| 'none'` | Indicates the direction of the activation (based on the previous active tab). |
