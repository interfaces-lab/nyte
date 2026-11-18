import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup, Textarea } from "@nyte-ai/ui/input";
import { useId } from "react";

export function InputDemo() {
  const keyHintId = useId();
  const errorId = useId();

  return (
    <div className="grid w-80 gap-3">
      <Input placeholder="Release notes" aria-label="Chat name" />
      <div className="grid gap-1">
        <Input variant="quiet" type="password" aria-label="API key" aria-describedby={keyHintId} />
        <p id={keyHintId} className="text-sm text-muted-foreground">
          Paste an API key from your provider.
        </p>
      </div>
      <div className="grid gap-1">
        <Input
          placeholder="https://example.com"
          aria-label="Server URL"
          aria-invalid
          aria-describedby={errorId}
          defaultValue="not-a-url"
        />
        <p id={errorId} className="text-sm text-muted-foreground">
          Enter a complete URL, such as https://example.com.
        </p>
      </div>
    </div>
  );
}

export function InputGroupDemo() {
  return (
    <div className="grid w-80 gap-3">
      <InputGroup>
        <Icon name="search" size="xs" />
        <Input placeholder="README.md" aria-label="Search workspace" />
      </InputGroup>
      <InputGroup variant="quiet">
        <Icon name="search" size="sm" />
        <Input placeholder="Claude" aria-label="Search models" />
      </InputGroup>
    </div>
  );
}

export function TextareaDemo() {
  return (
    <div className="w-80">
      <Textarea placeholder="Answer in concise sentences." aria-label="System prompt" />
    </div>
  );
}
