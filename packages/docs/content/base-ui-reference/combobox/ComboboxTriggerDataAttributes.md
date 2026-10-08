Data attributes of [Trigger](#trigger).

```typescript
declare namespace ComboboxTriggerDataAttributes {
  /** Present when the corresponding popup is open. */
  const popupOpen: 'data-popup-open';
  /** Present when the trigger is pressed. */
  const pressed: 'data-pressed';
  /** Present when the component is disabled. */
  const disabled: 'data-disabled';
  /** Present when the component is readonly. */
  const readonly: 'data-readonly';
  /**
   * Indicates which side the corresponding popup is positioned relative to its anchor.
   * @type 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start' | null
   */
  const popupSide: 'data-popup-side';
  /** Present when the component is required. */
  const required: 'data-required';
  /** Present when the component is in a valid state (when wrapped in Field.Root). */
  const valid: 'data-valid';
  /** Present when the component is in an invalid state (when wrapped in Field.Root). */
  const invalid: 'data-invalid';
  /** Present when the component has been touched (when wrapped in Field.Root). */
  const touched: 'data-touched';
  /** Present when the component's value has changed (when wrapped in Field.Root). */
  const dirty: 'data-dirty';
  /** Present when the component has a value (when wrapped in Field.Root). */
  const filled: 'data-filled';
  /** Present when the trigger is focused (when wrapped in Field.Root). */
  const focused: 'data-focused';
  /** Present when the corresponding items list is empty. */
  const listEmpty: 'data-list-empty';
  /** Present when the combobox doesn't have a value. */
  const placeholder: 'data-placeholder';
}
```
