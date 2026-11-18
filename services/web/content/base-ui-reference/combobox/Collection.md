Renders filtered list items.
Doesn't render its own HTML element.

If rendering a flat list, pass a function child to the `List` component instead, which implicitly wraps it.

**Collection Props:**

| Prop       | Type                                              | Default | Description |
| :--------- | :------------------------------------------------ | :------ | :---------- |
| children\* | `((item: any, index: number) => React.ReactNode)` | -       | -           |
