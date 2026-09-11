Controls a Dialog imperatively and associates detached `Dialog.Trigger` components with a
`Dialog.Root`. Create one with `Dialog.createHandle()` and pass it to the `handle` prop of the
root and of any triggers rendered outside of it.

The imperative methods take effect only while a root using this handle is mounted; calls made
before a root attaches (or after it unmounts) are ignored.

**Properties:**

| Property | Type      | Modifiers | Description                                                                                    |
| :------- | :-------- | :-------- | :--------------------------------------------------------------------------------------------- |
| isOpen   | `boolean` | readonly  | Whether the dialog is currently open. Returns `false` while no root is attached to the handle. |

**Methods:**

```typescript
function open(triggerId: string | null): void;
```

Opens the dialog, optionally associating it with a trigger.

This method should only be called in an event handler or an effect (not during rendering).

```typescript
function openWithPayload(payload: Payload): void;
```

Opens the dialog with the given payload, without associating it with any trigger.

This method should only be called in an event handler or an effect (not during rendering).

```typescript
function close(): void;
```

Closes the dialog.

This method should only be called in an event handler or an effect (not during rendering).

## External Types
