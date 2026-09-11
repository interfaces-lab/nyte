```typescript
type OffsetFunction = (data: {
  side: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start';
  align: 'start' | 'center' | 'end';
  anchor: { width: number; height: number };
  positioner: { width: number; height: number };
}) => number;
```

## Export Groups

- `PreviewCard.Root`: `PreviewCard.Root`, `PreviewCard.Root.State`, `PreviewCard.Root.Props`, `PreviewCard.Root.Actions`, `PreviewCard.Root.ChangeEventReason`, `PreviewCard.Root.ChangeEventDetails`
- `PreviewCard.Portal`: `PreviewCard.Portal`, `PreviewCard.Portal.State`, `PreviewCard.Portal.Props`
- `PreviewCard.Trigger`: `PreviewCard.Trigger`, `PreviewCard.Trigger.State`, `PreviewCard.Trigger.Props`
- `PreviewCard.Positioner`: `PreviewCard.Positioner`, `PreviewCard.Positioner.State`, `PreviewCard.Positioner.Props`
- `PreviewCard.Popup`: `PreviewCard.Popup`, `PreviewCard.Popup.State`, `PreviewCard.Popup.Props`
- `PreviewCard.Arrow`: `PreviewCard.Arrow`, `PreviewCard.Arrow.State`, `PreviewCard.Arrow.Props`
- `PreviewCard.Backdrop`: `PreviewCard.Backdrop`, `PreviewCard.Backdrop.State`, `PreviewCard.Backdrop.Props`
- `PreviewCard.Viewport`: `PreviewCard.Viewport`, `PreviewCard.Viewport.Props`, `PreviewCard.Viewport.State`
- `PreviewCard.createHandle`
- `PreviewCard.Handle`
- `Default`: `PreviewCardRootState`, `PreviewCardRootProps`, `PreviewCardRootActions`, `PreviewCardRootChangeEventReason`, `PreviewCardRootChangeEventDetails`, `PreviewCardTriggerState`, `PreviewCardTriggerProps`, `PreviewCardPortalState`, `PreviewCardPortalProps`, `PreviewCardPositionerState`, `PreviewCardPositionerProps`, `PreviewCardPopupState`, `PreviewCardPopupProps`, `PreviewCardArrowState`, `PreviewCardArrowProps`, `PreviewCardViewportState`, `PreviewCardViewportProps`, `PreviewCardBackdropState`, `PreviewCardBackdropProps`

## Canonical Types

Maps `Canonical`: `Alias` — Use Canonical when its namespace is already imported; otherwise use Alias.

- `PreviewCard.Root.State`: `PreviewCardRootState`
- `PreviewCard.Root.Props`: `PreviewCardRootProps`
- `PreviewCard.Root.Actions`: `PreviewCardRootActions`
- `PreviewCard.Root.ChangeEventReason`: `PreviewCardRootChangeEventReason`
- `PreviewCard.Root.ChangeEventDetails`: `PreviewCardRootChangeEventDetails`
- `PreviewCard.Portal.State`: `PreviewCardPortalState`
- `PreviewCard.Portal.Props`: `PreviewCardPortalProps`
- `PreviewCard.Trigger.State`: `PreviewCardTriggerState`
- `PreviewCard.Trigger.Props`: `PreviewCardTriggerProps`
- `PreviewCard.Positioner.State`: `PreviewCardPositionerState`
- `PreviewCard.Positioner.Props`: `PreviewCardPositionerProps`
- `PreviewCard.Popup.State`: `PreviewCardPopupState`
- `PreviewCard.Popup.Props`: `PreviewCardPopupProps`
- `PreviewCard.Arrow.State`: `PreviewCardArrowState`
- `PreviewCard.Arrow.Props`: `PreviewCardArrowProps`
- `PreviewCard.Backdrop.State`: `PreviewCardBackdropState`
- `PreviewCard.Backdrop.Props`: `PreviewCardBackdropProps`
- `PreviewCard.Viewport.Props`: `PreviewCardViewportProps`
- `PreviewCard.Viewport.State`: `PreviewCardViewportState`
