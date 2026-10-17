Data attributes of [Arrow](#arrow).

```typescript
declare namespace ComboboxArrowDataAttributes {
  /** Present when the popup is open. */
  const open: 'data-open';
  /** Present when the popup is closed. */
  const closed: 'data-closed';
  /**
   * Indicates which side the popup is positioned relative to the trigger.
   * @type 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start'
   */
  const side: 'data-side';
  /**
   * Indicates how the popup is aligned relative to specified side.
   * @type 'start' | 'center' | 'end'
   */
  const align: 'data-align';
  /** Present when the arrow is uncentered. */
  const uncentered: 'data-uncentered';
}
```
