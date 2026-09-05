# Desktop

- Preserve the Electron main/preload/renderer boundary. Session behavior belongs in core.
- Use Electron and Node APIs, not Bun-only APIs. Keep desktop-owned imports static;
  this overrides the shared style's dynamic-import preference.
- Use Vitest for state, host, and IPC behavior with real local fixtures where possible.
