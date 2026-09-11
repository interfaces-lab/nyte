Provides a shared delay for multiple tooltips. The grouping logic ensures that
once a tooltip becomes visible, the adjacent tooltips will be shown instantly.

**Provider Props:**

| Prop       | Type              | Default | Description                                                                                                               |
| :--------- | :---------------- | :------ | :------------------------------------------------------------------------------------------------------------------------ |
| delay      | `number`          | -       | How long to wait before opening the tooltip on hover. Specified in milliseconds.                                          |
| closeDelay | `number`          | -       | How long to wait before closing a tooltip. Specified in milliseconds.                                                     |
| timeout    | `number`          | `400`   | Another tooltip will open instantly if the previous tooltip&#xA;is closed within this timeout. Specified in milliseconds. |
| children   | `React.ReactNode` | -       | -                                                                                                                         |
