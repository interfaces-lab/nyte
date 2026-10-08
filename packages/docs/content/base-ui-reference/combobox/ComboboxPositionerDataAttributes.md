Data attributes of [Positioner](#positioner).

```typescript
declare namespace ComboboxPositionerDataAttributes {
  /** Present when the popup is open. */
  const open: 'data-open';
  /** Present when the popup is closed. */
  const closed: 'data-closed';
  /** Present when the anchor is hidden. */
  const anchorHidden: 'data-anchor-hidden';
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
  /** Present when the items list is empty. */
  const empty: 'data-empty';
}
```
