import { ActivityIndicator, StatusBar, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import { css, html } from "react-strict-dom";
import { ConnectScreen } from "../connection/connect-screen.tsx";
import { HostProvider, useHostConnection } from "../connection/host-context.tsx";
import { useAppliedAppearance } from "../settings/preferences.ts";
import { useTheme, spacing, tokens, typography } from "../theme.ts";

export const unstable_settings = { anchor: "index" };

export default function RootLayout() {
  useAppliedAppearance();
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const { host, connect, edit, cancelEdit, disconnect } = useHostConnection();
  const base = dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: theme.background,
      card: theme.background,
      text: theme.foreground,
      primary: theme.foreground,
      border: theme.border,
    },
  };
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
          {host.kind === "loading" ? (
            <html.div style={[styles.root, styles.centered]}>
              <ActivityIndicator color={theme.muted} />
            </html.div>
          ) : host.kind === "setup" ? (
            <html.div style={styles.root}>
              <ConnectScreen
                onConnect={connect}
                edit={
                  host.editing === undefined
                    ? undefined
                    : { connection: host.editing.connection, onCancel: cancelEdit }
                }
                notice={host.notice}
              />
            </html.div>
          ) : (
            <HostProvider
              session={{ client: host.client, connection: host.connection, edit, disconnect }}
            >
              <Stack
                screenOptions={{
                  headerTransparent: false,
                  headerShadowVisible: false,
                  headerLargeTitleShadowVisible: false,
                  headerBackButtonDisplayMode: "minimal",
                  headerTintColor: theme.foreground,
                  headerTitleStyle: {
                    color: theme.foreground,
                    fontSize: typography.title.fontSize,
                    fontWeight: "600",
                  },
                  headerLargeTitleStyle: {
                    color: theme.foreground,
                    fontSize: typography.heading.fontSize,
                    fontWeight: "600",
                  },
                  headerStyle: { backgroundColor: theme.background },
                  headerLargeStyle: { backgroundColor: theme.background },
                  contentStyle: { backgroundColor: theme.background },
                }}
              >
                <Stack.Screen
                  name="index"
                  options={{ title: "Agents", headerLargeTitleEnabled: true }}
                />
                <Stack.Screen name="settings" options={{ title: "Settings" }} />
                <Stack.Screen
                  name="chat/[id]"
                  options={{
                    title: "",
                    // The transcript scrolls under a glass bar; the title rides on it.
                    headerTransparent: true,
                    headerBlurEffect: "systemChromeMaterial",
                    headerStyle: { backgroundColor: "transparent" },
                  }}
                />
                <Stack.Screen name="changes/[id]" options={{ title: "Changed Files" }} />
                <Stack.Screen name="review/[id]" options={{ title: "" }} />
                <Stack.Screen
                  name="annotate"
                  options={{ presentation: "fullScreenModal", headerShown: false }}
                />
              </Stack>
            </HostProvider>
          )}
        </ThemeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const styles = css.create({
  // The screen's own box: its parent is the native root, not a flex container,
  // so it fills by size rather than by growing inside one.
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: tokens.background,
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
