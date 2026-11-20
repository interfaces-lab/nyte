Controls a Menu imperatively and associates detached `Menu.Trigger` components with a `Menu.Root`.
Create one with `Menu.createHandle()` and pass it to the `handle` prop of the root and of any
triggers rendered outside of it.

The imperative methods take effect only while a root using this handle is mounted; calls made
before a root attaches (or after it unmounts) are ignored.

**Properties:**

| Property | Type      | Modifiers | Description                                                                                  |
| :------- | :-------- | :-------- | :------------------------------------------------------------------------------------------- |
| isOpen   | `boolean` | readonly  | Whether the menu is currently open. Returns `false` while no root is attached to the handle. |

**Methods:**

```typescript
function open(triggerId: string): void;
```

Opens the menu and associates it with the trigger with the given id.

This method should only be called in an event handler or an effect (not during rendering).

```typescript
function close(): void;
```

Closes the menu.

This method should only be called in an event handler or an effect (not during rendering).
