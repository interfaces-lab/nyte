A link that opens the preview card.
Renders an `<a>` element.

**Trigger Props:**

| Prop       | Type                                                                                                                                                                     | Default | Description                                                                                                                                                                                   |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handle     | `PreviewCard.Handle<Payload>`                                                                                                                                            | -       | A handle to associate the trigger with a preview card.                                                                                                                                        |
| payload    | `Payload`                                                                                                                                                                | -       | A payload to pass to the preview card when it is opened.                                                                                                                                      |
| delay      | `number`                                                                                                                                                                 | `600`   | How long to wait before the preview card opens. Specified in milliseconds.                                                                                                                    |
| closeDelay | `number`                                                                                                                                                                 | `300`   | How long to wait before closing the preview card. Specified in milliseconds.                                                                                                                  |
| className  | `string \| ((state: PreviewCard.Trigger.State) => string \| undefined)`                                                                                                  | -       | CSS class applied to the element, or a function that&#xA;returns a class based on the component's state.                                                                                      |
| style      | `React.CSSProperties \| ((state: PreviewCard.Trigger.State) => React.CSSProperties \| undefined)`                                                                        | -       | Style applied to the element, or a function that&#xA;returns a style object based on the component's state.                                                                                   |
| render     | `ReactElement \| ((props: React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>, state: PreviewCard.Trigger.State) => ReactElement)` | -       | Allows you to replace the component's HTML element&#xA;with a different tag, or compose it with another component. Accepts a `ReactElement` or a function that returns the element to render. |

**Trigger Data Attributes:**

| Attribute       | Type | Description                                          |
| :-------------- | :--- | :--------------------------------------------------- |
| data-popup-open | -    | Present when the corresponding preview card is open. |
