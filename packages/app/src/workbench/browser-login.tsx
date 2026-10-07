import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Input } from "@nyte-ai/ui/input";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { nyte } from "../nyte.ts";
import { dismissLogin } from "./browser-surfaces.ts";

const styles = create({
  popup: { width: 380 },
  form: { display: "flex", flexDirection: "column", gap: 10 },
  host: {
    overflowWrap: "anywhere",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontFamily: type.fontMono,
  },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { color: role.contentSecondary, fontSize: type.fontSm },
});

interface LoginDialogProps {
  readonly surface: string;
  readonly host: string;
  readonly realm: string;
}

/** The page answered 401; Chromium holds the request until this answers it. */
export function LoginDialog({ surface, host, realm }: LoginDialogProps): ReactElement {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const answer = (
    credentials: { readonly username: string; readonly password: string } | undefined,
  ): void => {
    void nyte.host.browser?.login({ surface, credentials }).catch(() => undefined);
    dismissLogin(surface);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    answer({ username, password });
  };

  return (
    <Dialog.Root defaultOpen onOpenChange={(open) => !open && answer(undefined)}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title>Sign in</Dialog.Title>
        <Dialog.Description>
          <span {...props(styles.host)}>{host}</span>
          {realm !== "" && ` asks for a username and password for “${realm}”.`}
          {realm === "" && " asks for a username and password."}
        </Dialog.Description>
        <form {...props(styles.form)} onSubmit={submit}>
          <label {...props(styles.field)}>
            <span {...props(styles.label)}>Username</span>
            <Input
              autoFocus
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onValueChange={setUsername}
            />
          </label>
          <label {...props(styles.field)}>
            <span {...props(styles.label)}>Password</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onValueChange={setPassword}
            />
          </label>
          <Dialog.Footer>
            <Button type="button" onClick={() => answer(undefined)}>
              Cancel
            </Button>
            <Button type="submit" variant="solid" tone="primary">
              Sign In
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
