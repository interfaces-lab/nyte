The image to be displayed in the avatar.
Renders an `<img>` element.

**Image Props:**

| Prop                  | Type                                                                                                                                                         | Default | Description                                                                                                                                                                                   |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| onLoadingStatusChange | `((status: ImageLoadingStatus) => void)`                                                                                                                     | -       | Callback fired when the loading status changes.                                                                                                                                               |
| className             | `string \| ((state: Avatar.Image.State) => string \| undefined)`                                                                                             | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style                 | `React.CSSProperties \| ((state: Avatar.Image.State) => React.CSSProperties \| undefined)`                                                                   | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| keepMounted           | `boolean`                                                                                                                                                    | `false` | Whether the image element stays mounted and loads in place instead of being preloaded.&#xA;Supports `loading="lazy"` and optimized image components such as `next/image`.                     |
| render                | `ReactElement \| ((props: React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>, state: Avatar.Image.State) => ReactElement)` | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Image Data Attributes:**

| Attribute           | Type | Description                                 |
| :------------------ | :--- | :------------------------------------------ |
| data-error          | -    | Present when the image failed to load.      |
| data-loading        | -    | Present while the image is loading.         |
| data-starting-style | -    | Present when the image begins animating in. |
| data-ending-style   | -    | Present when the image is animating out.    |
