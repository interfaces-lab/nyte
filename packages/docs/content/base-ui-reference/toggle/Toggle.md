A two-state button that can be on or off.
Renders a `<button>` element.

**Toggle Props:**

| Prop            | Type                                                                                 | Default | Description                                                                                                                                                                                   |
| :-------------- | :----------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| value           | `string`                                                                             | -       | A unique string that identifies the toggle when used&#xA;inside a toggle group.                                                                                                               |
| defaultPressed  | `boolean`                                                                            | `false` | Whether the toggle button is currently pressed.&#xA;This is the uncontrolled counterpart of `pressed`.                                                                                        |
| pressed         | `boolean`                                                                            | -       | Whether the toggle button is currently pressed.&#xA;This is the controlled counterpart of `defaultPressed`.                                                                                   |
| onPressedChange | `((pressed: boolean, eventDetails: Toggle.ChangeEventDetails) => void)`              | -       | Callback fired when the pressed state is changed.                                                                                                                                             |
| nativeButton    | `boolean`                                                                            | `true`  | Whether the component renders a native `<button>` element when replacing it&#xA;via the `render` prop.&#xA;Set to `false` if the rendered element is not a button (for example, `<div>`).     |
| disabled        | `boolean`                                                                            | `false` | Whether the component should ignore user interaction.                                                                                                                                         |
| className       | `string \| ((state: Toggle.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style           | `React.CSSProperties \| ((state: Toggle.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render          | `ReactElement \| ((props: HTMLProps, state: Toggle.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Toggle Data Attributes:**

| Attribute     | Type | Description                                 |
| :------------ | :--- | :------------------------------------------ |
| data-pressed  | -    | Present when the toggle button is pressed.  |
| data-disabled | -    | Present when the toggle button is disabled. |
