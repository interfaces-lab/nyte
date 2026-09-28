"use client";

import { Icon, Input, InputGroup, Textarea } from "@nyte-ai/ui";

export function InputDemo() {
  return (
    <div className="grid w-80 gap-3">
      <Input placeholder="Chat name" aria-label="Chat name" />
      <Input
        variant="quiet"
        size="sm"
        type="password"
        placeholder="Paste your API key"
        aria-label="API key"
      />
      <Input
        placeholder="Server URL"
        aria-label="Server URL"
        aria-invalid
        defaultValue="not-a-url"
      />
    </div>
  );
}

export function InputGroupDemo() {
  return (
    <div className="grid w-80 gap-3">
      <InputGroup>
        <Icon name="search" size={12} />
        <Input placeholder="Search" aria-label="Search workspace" />
      </InputGroup>
      <InputGroup variant="quiet">
        <Icon name="search" size={13} />
        <Input placeholder="Search models" aria-label="Search models" />
      </InputGroup>
    </div>
  );
}

export function TextareaDemo() {
  return (
    <div className="w-80">
      <Textarea placeholder="System prompt" aria-label="System prompt" />
    </div>
  );
}
