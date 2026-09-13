import { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { css, html } from "react-strict-dom";
import type { NyteClient } from "@nyte-ai/client";
import { ConnectScreen } from "./connection/connect-screen.tsx";
import { describeHostError, type Connection } from "./connection/connection.ts";
import {
  createHostClient,
  forgetConnection,
  readConnection,
  saveConnection,
  verifyHost,
} from "./connection/host.ts";
import { nativeTheme, spacing, tokens } from "./theme.ts";
import { ChatsScreen } from "./chat/chats-screen.tsx";
type HostConnectionState =
  | { kind: "loading" }
  | { kind: "setup"; notice?: string }
  | { kind: "connected"; connection: Connection; client: NyteClient };

export default function App() {
  const [host, setHost] = useState<HostConnectionState>({ kind: "loading" });
  useEffect(() => {
    let mounted = true;
    void readConnection()
      .then((connection) => {
        if (mounted)
          setHost(
            connection
              ? { kind: "connected", connection, client: createHostClient(connection) }
              : { kind: "setup" },
          );
      })
      .catch(() => {
        if (mounted)
          setHost({ kind: "setup", notice: "Connect your Mac again to restore access." });
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function connect(connection: Connection, signal: AbortSignal) {
    try {
      await verifyHost(connection, signal);
    } catch (cause) {
      throw new Error(describeHostError(cause));
    }
    if (signal.aborted) throw new Error("Connection cancelled.");
    try {
      await saveConnection(connection);
    } catch {
      throw new Error("Couldn't save the token in the Keychain. Try again.");
    }
    if (signal.aborted) {
      await forgetConnection();
      throw new Error("Connection cancelled.");
    }
    setHost({ kind: "connected", connection, client: createHostClient(connection) });
  }

  async function disconnect() {
    await forgetConnection();
    setHost({ kind: "setup" });
  }

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar barStyle="light-content" />
        <html.div data-layoutconformance="strict" style={styles.root}>
          {host.kind === "loading" ? (
            <html.div style={styles.centered}>
              <ActivityIndicator color={nativeTheme.muted} />
            </html.div>
          ) : host.kind === "setup" ? (
            <ConnectScreen onConnect={connect} notice={host.notice} />
          ) : (
            <ChatsScreen
              client={host.client}
              connection={host.connection}
              onDisconnect={disconnect}
            />
          )}
        </html.div>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: tokens.background,
  },
  centered: {
    flexGrow: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
