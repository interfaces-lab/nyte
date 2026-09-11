"use client";

import { Input, Textarea } from "@nyte-ai/ui";

export function InputDemo() {
  return (
    <div style={{ display: "grid", gap: 12, width: 320 }}>
      <Input placeholder="Workspace name" aria-label="Workspace name" />
      <Input placeholder="Invalid" aria-label="Invalid" aria-invalid defaultValue="not-a-url" />
      <Input placeholder="Disabled" aria-label="Disabled" disabled />
    </div>
  );
}

export function TextareaDemo() {
  return (
    <div style={{ width: 320 }}>
      <Textarea placeholder="System prompt" aria-label="System prompt" />
    </div>
  );
}
