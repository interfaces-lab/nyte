Provides a shared state to a series of toggle buttons.

**ToggleGroup Props:**

| Prop          | Type                                                                                      | Default        | Description                                                                                                                                                                                   |
| :------------ | :---------------------------------------------------------------------------------------- | :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| defaultValue  | `string[]`                                                                                | -              | The pressed state of the toggle group represented by an array of&#xA;the values of all pressed toggle buttons.&#xA;This is the uncontrolled counterpart of `value`.                           |
| value         | `string[]`                                                                                | -              | The pressed state of the toggle group represented by an array of&#xA;the values of all pressed toggle buttons.&#xA;This is the controlled counterpart of `defaultValue`.                      |
| onValueChange | `((groupValue: string[], eventDetails: ToggleGroup.ChangeEventDetails) => void)`          | -              | Callback fired when the pressed states of the toggle group changes.                                                                                                                           |
| loopFocus     | `boolean`                                                                                 | `true`         | Whether to loop keyboard focus back to the first item&#xA;when the end of the list is reached while using the arrow keys.                                                                     |
| multiple      | `boolean`                                                                                 | `false`        | When `false` only one item in the group can be pressed. If any item in&#xA;the group becomes pressed, the others will become unpressed.&#xA;When `true` multiple items can be pressed.        |
| disabled      | `boolean`                                                                                 | `false`        | Whether the toggle group should ignore user interaction.                                                                                                                                      |
| orientation   | `Orientation`                                                                             | `'horizontal'` | -                                                                                                                                                                                             |
| className     | `string \| ((state: ToggleGroup.State) => string \| undefined)`                           | -              | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style         | `React.CSSProperties \| ((state: ToggleGroup.State) => React.CSSProperties \| undefined)` | -              | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render        | `ReactElement \| ((props: HTMLProps, state: ToggleGroup.State) => ReactElement)`          | -              | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**ToggleGroup Data Attributes:**

| Attribute        | Type                         | Description                                                                                        |
| :--------------- | :--------------------------- | :------------------------------------------------------------------------------------------------- |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the toggle group.                                                     |
| data-disabled    | -                            | Present when the toggle group is disabled.                                                         |
| data-multiple    | -                            | Present when the toggle group allows multiple buttons to be in the pressed state at the same time. |
