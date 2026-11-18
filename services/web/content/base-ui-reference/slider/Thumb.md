The draggable part of the slider at the tip of the indicator.
Renders a `<div>` element and a nested `<input type="range">`.

**Thumb Props:**

| Prop             | Type                                                                                       | Default | Description                                                                                                                                                                                                                                      |
| :--------------- | :----------------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| aria-valuetext   | `string`                                                                                   | -       | A string value forwarded to the [`aria-valuetext`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-valuetext) attribute of the `input`.&#xA;Ignored when `getAriaValueText` is provided.               |
| getAriaLabel     | `((index: number) => string) \| null`                                                      | -       | A function which returns a string value for the [`aria-label`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label) attribute of the `input`.                                                        |
| getAriaValueText | `((formattedValue: string, value: number, index: number) => string) \| null`               | -       | A function which returns a string value for the [`aria-valuetext`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-valuetext) attribute of the `input`.&#xA;This is important for screen reader users. |
| index            | `number`                                                                                   | -       | The index of the thumb which corresponds to the index of its value in the&#xA;`value` or `defaultValue` array.&#xA;This prop is required to support server-side rendering for range sliders&#xA;with multiple thumbs.                            |
| onBlur           | `React.FocusEventHandler<HTMLInputElement>`                                                | -       | A blur handler forwarded to the `input`.                                                                                                                                                                                                         |
| onFocus          | `React.FocusEventHandler<HTMLInputElement>`                                                | -       | A focus handler forwarded to the `input`.                                                                                                                                                                                                        |
| onKeyDown        | `React.KeyboardEventHandler<HTMLInputElement>`                                             | -       | A keydown handler forwarded to the `input`.                                                                                                                                                                                                      |
| tabIndex         | `number`                                                                                   | -       | Optional tab index attribute forwarded to the `input`.                                                                                                                                                                                           |
| disabled         | `boolean`                                                                                  | `false` | Whether the thumb should ignore user interaction.                                                                                                                                                                                                |
| inputRef         | `React.Ref<HTMLInputElement>`                                                              | -       | A ref to access the nested input element.                                                                                                                                                                                                        |
| className        | `string \| ((state: Slider.Thumb.State) => string \| undefined)`                           | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                                                                         |
| style            | `React.CSSProperties \| ((state: Slider.Thumb.State) => React.CSSProperties \| undefined)` | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                                                                      |
| render           | `ReactElement \| ((props: HTMLProps, state: Slider.Thumb.State) => ReactElement)`          | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render.                                                    |

**`index` Prop Example:**

```tsx
<Slider.Root value={[10, 20]}>
  <Slider.Thumb index={0} />
  <Slider.Thumb index={1} />
</Slider.Root>
```

**Thumb Data Attributes:**

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
| data-index       | -                            | Indicates the index of the thumb in range sliders.                           |
