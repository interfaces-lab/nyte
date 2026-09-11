```typescript
type OffsetFunction = (data: {
  side: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start';
  align: 'start' | 'center' | 'end';
  anchor: { width: number; height: number };
  positioner: { width: number; height: number };
}) => number;
```

## Export Groups

- `Tooltip.Root`: `Tooltip.Root`, `Tooltip.Root.State`, `Tooltip.Root.Props`, `Tooltip.Root.Actions`, `Tooltip.Root.ChangeEventReason`, `Tooltip.Root.ChangeEventDetails`
- `Tooltip.Trigger`: `Tooltip.Trigger`, `Tooltip.Trigger.State`, `Tooltip.Trigger.Props`
- `Tooltip.Portal`: `Tooltip.Portal`, `Tooltip.Portal.State`, `Tooltip.Portal.Props`
- `Tooltip.Positioner`: `Tooltip.Positioner`, `Tooltip.Positioner.State`, `Tooltip.Positioner.Props`
- `Tooltip.Popup`: `Tooltip.Popup`, `Tooltip.Popup.State`, `Tooltip.Popup.Props`
- `Tooltip.Arrow`: `Tooltip.Arrow`, `Tooltip.Arrow.State`, `Tooltip.Arrow.Props`
- `Tooltip.Provider`: `Tooltip.Provider`, `Tooltip.Provider.State`, `Tooltip.Provider.Props`
- `Tooltip.Viewport`: `Tooltip.Viewport`, `Tooltip.Viewport.Props`, `Tooltip.Viewport.State`
- `Tooltip.createHandle`
- `Tooltip.Handle`
- `Default`: `TooltipProviderState`, `TooltipProviderProps`, `TooltipRootState`, `TooltipRootProps`, `TooltipRootActions`, `TooltipRootChangeEventReason`, `TooltipRootChangeEventDetails`, `TooltipTriggerState`, `TooltipTriggerProps`, `TooltipPortalState`, `TooltipPortalProps`, `TooltipPositionerState`, `TooltipPositionerProps`, `TooltipPopupState`, `TooltipPopupProps`, `TooltipViewportState`, `TooltipViewportProps`, `TooltipArrowState`, `TooltipArrowProps`

## Canonical Types

Maps `Canonical`: `Alias` — Use Canonical when its namespace is already imported; otherwise use Alias.

- `Tooltip.Root.State`: `TooltipRootState`
- `Tooltip.Root.Props`: `TooltipRootProps`
- `Tooltip.Root.Actions`: `TooltipRootActions`
- `Tooltip.Root.ChangeEventReason`: `TooltipRootChangeEventReason`
- `Tooltip.Root.ChangeEventDetails`: `TooltipRootChangeEventDetails`
- `Tooltip.Trigger.State`: `TooltipTriggerState`
- `Tooltip.Trigger.Props`: `TooltipTriggerProps`
- `Tooltip.Portal.State`: `TooltipPortalState`
- `Tooltip.Portal.Props`: `TooltipPortalProps`
- `Tooltip.Positioner.State`: `TooltipPositionerState`
- `Tooltip.Positioner.Props`: `TooltipPositionerProps`
- `Tooltip.Popup.State`: `TooltipPopupState`
- `Tooltip.Popup.Props`: `TooltipPopupProps`
- `Tooltip.Arrow.State`: `TooltipArrowState`
- `Tooltip.Arrow.Props`: `TooltipArrowProps`
- `Tooltip.Provider.State`: `TooltipProviderState`
- `Tooltip.Provider.Props`: `TooltipProviderProps`
- `Tooltip.Viewport.Props`: `TooltipViewportProps`
- `Tooltip.Viewport.State`: `TooltipViewportState`
