import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { HostId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { errorMessage } from "../errors.ts";
import { connectionProblem, hostChanged } from "../sdk.tsx";
import type { Connection } from "./bridge.ts";
import { parseConnection, saveConnection } from "./connection.ts";
import { webBridge } from "./install.ts";
import { connectPinned } from "./pins.ts";
import { WebPage } from "./web-page.tsx";

const styles = create({
  form: { display: "flex", flexDirection: "column", gap: space.s4 },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
  },
  label: { fontWeight: type.weightMedium },
  error: { margin: 0 },
  changed: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
});

export type ConnectFailure =
  | { readonly kind: "problem"; readonly message: string }
  | { readonly kind: "identity_changed" };

export function connectFailure(cause: unknown): ConnectFailure {
  return hostChanged(cause)
    ? { kind: "identity_changed" }
    : { kind: "problem", message: connectionProblem(cause).message };
}

export function connectAddress(connection: Connection, repair: boolean): Promise<HostId> {
  return connectPinned({
    bridge: webBridge,
    storage: localStorage,
    route: { kind: "address", url: connection.url },
    connection,
    repair,
  });
}

interface ConnectScreenProps {
  readonly initial?: Connection;
  readonly failure?: ConnectFailure;
  readonly onConnected: (connection: Connection) => void;
  readonly onBack?: () => void;
}

export function ConnectScreen({
  initial,
  failure: initialFailure,
  onConnected,
  onBack,
}: ConnectScreenProps): ReactElement {
  const errorId = useId();
  const connecting = useRef(false);
  const [address, setAddress] = useState(initial?.url ?? "");
  const [token, setToken] = useState(initial?.token ?? "");
  const [failure, setFailure] = useState(initialFailure);
  const [pending, setPending] = useState(false);

  const connect = async (repair: boolean): Promise<void> => {
    if (connecting.current) return;
    let connection: Connection;

    try {
      connection = parseConnection({ url: address, token });
    } catch (cause) {
      setFailure({ kind: "problem", message: errorMessage(cause) });

      return;
    }

    setFailure(undefined);
    connecting.current = true;
    setPending(true);

    try {
      await connectAddress(connection, repair);
    } catch (cause) {
      setFailure(connectFailure(cause));
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
          void connect(false);
        }}
      >
        <label {...props(text.base, styles.field)}>
          <span {...props(styles.label)}>Address</span>
          <Input
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://<name>.ts.net"
            value={address}
            readOnly={pending}
            aria-invalid={failure !== undefined}
            aria-describedby={failure !== undefined ? errorId : undefined}
            onValueChange={(value) => {
              setAddress(value);

              if (failure?.kind === "identity_changed") setFailure(undefined);
            }}
          />
        </label>
        <label {...props(text.base, styles.field)}>
          <span {...props(styles.label)}>Token</span>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            readOnly={pending}
            aria-invalid={failure !== undefined}
            aria-describedby={failure !== undefined ? errorId : undefined}
            onValueChange={setToken}
          />
        </label>
        {failure?.kind === "problem" && (
          <p id={errorId} role="alert" {...props(text.sm, intent.danger, styles.error)}>
            {failure.message}
          </p>
        )}
        {failure?.kind === "identity_changed" && (
          <div {...props(styles.changed)}>
            <p id={errorId} role="alert" {...props(text.sm, intent.danger, styles.error)}>
              This address answers with a different host identity than the one you paired with. Pair
              again only if you replaced or reinstalled that host.
            </p>
            <Button type="button" size="sm" disabled={pending} onClick={() => void connect(true)}>
              Pair as New Host
            </Button>
          </div>
        )}
        <Button type="submit" variant="solid" tone="primary" loading={pending}>
          Connect
        </Button>
      </form>
    </WebPage>
  );
}
