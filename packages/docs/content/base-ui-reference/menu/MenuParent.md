```typescript
type MenuParent =
  | { type: 'menu'; store: MenuStore<unknown> }
  | { type: 'menubar'; context: MenubarContext }
  | { type: 'context-menu'; context: ContextMenuRootContext }
  | { type: 'nested-context-menu'; context: ContextMenuRootContext; menuContext: MenuRootContext }
  | { type: undefined };
```

## External Types
