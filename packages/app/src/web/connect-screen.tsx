import { shape } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { role, shadow, type } from "@nyte-ai/ui/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { errorMessage } from "../errors.ts";
import { serverConnectionProblem } from "../server-connection.ts";
import type { Connection } from "./bridge.ts";
import { parseConnection, saveConnection } from "./connection.ts";
import { webBridge } from "./install.ts";

const styles = create({
  page: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    padding: 24,
    backgroundColor: role.bgBase,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 360,
    padding: 24,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: shape.card,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMd,
  },
  heading: { margin: 0, fontSize: type.fontLg, lineHeight: type.leadingLg, fontWeight: 600 },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  error: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});

interface ConnectScreenProps {
  /** Prefills the form, for a saved or linked connection that failed to connect. */
  readonly initial?: Connection;
  readonly problem?: string;
  readonly onConnected: (connection: Connection) => void;
}

export function ConnectScreen({ initial, problem, onConnected }: ConnectScreenProps): ReactElement {
  const errorId = useId();
  const connecting = useRef(false);
  const [address, setAddress] = useState(initial?.url ?? "");
  const [token, setToken] = useState(initial?.token ?? "");
  const [error, setError] = useState(problem);
  const [pending, setPending] = useState(false);

  const connect = async (): Promise<void> => {
    if (connecting.current) return;
    let connection: Connection;

    try {
      connection = parseConnection({ url: address, token });
    } catch (cause) {
      setError(errorMessage(cause));

      return;
    }

    setError(undefined);
    connecting.current = true;
    setPending(true);

    try {
      await webBridge.connect(connection);
    } catch (cause) {
      setError(serverConnectionProblem(cause).message);
      connecting.current = false;
      setPending(false);

      return;
    }

    saveConnection(connection);
    onConnected(connection);
  };

  return (
    <main {...props(styles.page)}>
      <form
        {...props(styles.card)}
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <h1 {...props(styles.heading)}>Connect to a Mac</h1>
        <label {...props(styles.field)}>
          Address
          <Input
            type="url"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            placeholder="http://100.64.0.1:52000"
            value={address}
            readOnly={pending}
            aria-invalid={error !== undefined}
            aria-describedby={error !== undefined ? errorId : undefined}
            onValueChange={setAddress}
          />
        </label>
        <label {...props(styles.field)}>
          Token
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            readOnly={pending}
            aria-invalid={error !== undefined}
            aria-describedby={error !== undefined ? errorId : undefined}
            onValueChange={setToken}
          />
        </label>
        {error !== undefined && (
          <p id={errorId} role="alert" {...props(intent.danger, styles.error)}>
            {error}
          </p>
        )}
        <Button type="submit" variant="solid" tone="primary" loading={pending}>
          Connect to Mac
        </Button>
      </form>
    </main>
  );
}
