import { create } from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactElement } from "react";
import { Input } from "@nyte-ai/ui/input";
import { Popover } from "@nyte-ai/ui/popover";
import { menu, space } from "@nyte-ai/ui/styles/schema.stylex";

const styles = create({
  popup: { padding: space.s1 },
  name: { width: menu.width, maxWidth: "var(--available-width)" },
});

export function RenameField(input: {
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  readonly name: string;
  readonly busy: boolean;
  readonly onRename: (name: string) => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const field = useRef<HTMLInputElement>(null);

  return (
    <Popover.Root open modal={false} onOpenChange={(open) => !open && input.onClose()}>
      <Popover.Portal>
        <Popover.Positioner anchor={input.anchor} side="bottom" align="start" sideOffset={4}>
          <Popover.Popup initialFocus={field} aria-label="Rename" xstyle={styles.popup}>
            <Input
              ref={field}
              variant="code"
              aria-label="New name"
              aria-busy={input.busy}
              readOnly={input.busy}
              defaultValue={input.name}
              spellCheck={false}
              autoComplete="off"
              xstyle={styles.name}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                event.stopPropagation();

                if (event.nativeEvent.isComposing) return;

                if (event.key === "Escape") {
                  event.preventDefault();
                  input.onCancel();
                }

                if (event.key === "Enter" && !input.busy) {
                  event.preventDefault();
                  input.onRename(event.currentTarget.value.trim());
                }
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
