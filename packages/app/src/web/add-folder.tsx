import { Dialog } from "@nyte-ai/ui/dialog";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";

const styles = create({
  popup: {
    gap: space.s3,
    width: "min(460px, calc(100vw - 48px))",
    padding: space.s5,
    borderStyle: "none",
  },
  title: { lineHeight: type.leadingBase },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
  },
  host: { color: role.contentSecondary },
});

interface FolderPrompt {
  readonly hostId: string;
  readonly resolve: (path: string | undefined) => void;
}

let prompt: FolderPrompt | undefined;

const listeners = new Set<() => void>();

function setPrompt(next: FolderPrompt | undefined): void {
  prompt = next;

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function requestFolderPath(hostId: string): Promise<string | undefined> {
  prompt?.resolve(undefined);

  return new Promise((resolve) => {
    setPrompt({ hostId, resolve });
  });
}

function FolderPromptDialog({ current }: { readonly current: FolderPrompt }): ReactElement {
  const [path, setPath] = useState("");

  const finish = (value: string | undefined): void => {
    setPrompt(undefined);
    current.resolve(value);
  };

  return (
    <Dialog.Root defaultOpen onOpenChange={(open) => !open && finish(undefined)}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={styles.title}>Add Folder on Host</Dialog.Title>
        <form
          {...props(text.base, styles.field)}
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = path.trim();

            if (trimmed !== "") finish(trimmed);
          }}
        >
          <label {...props(text.base, styles.field)}>
            <span>Full path on the host</span>
            <Input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="/home/me/code/app"
              value={path}
              onValueChange={setPath}
            />
          </label>
          <span {...props(text.sm, styles.host)}>Host {current.hostId}</span>
          <Dialog.Footer>
            <Button type="button" onClick={() => finish(undefined)}>
              Cancel
            </Button>
            <Button type="submit" variant="solid" tone="primary" disabled={path.trim() === ""}>
              Add Folder
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export function AddFolderDialogHost(): ReactElement | null {
  const current = useSyncExternalStore(subscribe, () => prompt);

  if (current === undefined) return null;

  return <FolderPromptDialog key={current.hostId} current={current} />;
}
