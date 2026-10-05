import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { type } from "@nyte-ai/ui/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { errorMessage } from "../errors.ts";
import { serverConnectionProblem } from "../server-connection.ts";
import type { Connection } from "./bridge.ts";
import { parseConnection, saveConnection } from "./connection.ts";
import { webBridge } from "./install.ts";
import { WebPage } from "./web-page.tsx";

const styles = create({
  form: { display: "flex", flexDirection: "column", gap: 16 },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  label: { fontWeight: 500 },
  error: {
    margin: 0,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});

interface ConnectScreenProps {
  /** Prefills the form, for a saved or linked connection that failed to connect. */
  readonly initial?: Connection;
  readonly problem?: string;
  readonly onConnected: (connection: Connection) => void;
  readonly onBack?: () => void;
}

export function ConnectScreen({
  initial,
  problem,
  onConnected,
  onBack,
}: ConnectScreenProps): ReactElement {
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
    <WebPage
      title="Connect to a Desktop"
      busy={pending}
      footer={
        onBack !== undefined && (
          <Button size="sm" disabled={pending} onClick={onBack}>
            Sign In Instead
          </Button>
        )
      }
    >
      <form
        {...props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label {...props(styles.field)}>
          <span {...props(styles.label)}>Address</span>
          <Input
            type="url"
            autoComplete="off"
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
          <span {...props(styles.label)}>Token</span>
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
          Connect
        </Button>
      </form>
    </WebPage>
  );
}
