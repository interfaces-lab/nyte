Displays the current value of the slider as text.
Renders an `<output>` element.

**Value Props:**

| Prop      | Type                                                                                       | Default | Description                                                                                                                                                                                   |
| :-------- | :----------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| children  | `((formattedValues: string[], values: number[]) => React.ReactNode) \| null`               | -       | -                                                                                                                                                                                             |
| className | `string \| ((state: Slider.Value.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style     | `React.CSSProperties \| ((state: Slider.Value.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render    | `ReactElement \| ((props: HTMLProps, state: Slider.Value.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Value Data Attributes:**

| Attribute        | Type                         | Description                                                                  |
| :--------------- | :--------------------------- | :--------------------------------------------------------------------------- |
| data-dragging    | -                            | Present while the user is dragging.                                          |
| data-orientation | `'horizontal' \| 'vertical'` | Indicates the orientation of the slider.                                     |
| data-disabled    | -                            | Present when the slider is disabled.                                         |
| data-valid       | -                            | Present when the slider is in a valid state (when wrapped in Field.Root).    |
| data-invalid     | -                            | Present when the slider is in an invalid state (when wrapped in Field.Root). |
| data-dirty       | -                            | Present when the slider's value has changed (when wrapped in Field.Root).    |
| data-touched     | -                            | Present when the slider has been touched (when wrapped in Field.Root).       |
| data-focused     | -                            | Present when the slider is focused (when wrapped in Field.Root).             |
