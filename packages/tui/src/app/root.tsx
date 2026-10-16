import type { JSX } from "@opentui/solid";
import { ErrorBoundary, onCleanup } from "solid-js";
import { themeFor } from "../lib/theme.ts";
import type { CliTheme } from "../lib/theme.ts";
import { ErrorScreen } from "../ui/chrome/error-screen.tsx";
import { Screen } from "../ui/screen.tsx";
import { AppProvider } from "./context.tsx";
import type { Kit } from "./context.tsx";
import type { Store } from "./store.ts";

export interface RootProps {
  readonly store: Store;
  readonly kit: Kit;
  readonly report: (origin: "render", error: unknown) => void;
  readonly logPath: string;
  readonly quit: () => void;
  readonly onFallen: (reset: (() => void) | null) => void;
}

export function Root(props: RootProps): JSX.Element {
  return (
    <ErrorBoundary fallback={drawFallen(props)}>
      <AppProvider
        app={{ screen: props.store.screen, dispatch: props.store.dispatch, kit: props.kit }}
      >
        <Screen />
      </AppProvider>
    </ErrorBoundary>
  );
}

function drawFallen(props: RootProps): (error: unknown, reset: () => void) => JSX.Element {
  return (error, reset) => (
    <Fallen
      theme={fallbackTheme(props.store)}
      error={error}
      reset={reset}
      logPath={props.logPath}
      quit={props.quit}
      report={props.report}
      onFallen={props.onFallen}
    />
  );
}

/** The error screen's theme, read from the state rather than the kit, which may be what threw. */
function fallbackTheme(store: Store): CliTheme {
  const { settings, terminal } = store.state().facts;

  return themeFor(settings.theme, terminal.theme);
}

function Fallen(
  props: Pick<RootProps, "logPath" | "quit" | "report" | "onFallen"> & {
    readonly theme: CliTheme;
    readonly error: unknown;
    readonly reset: () => void;
  },
): JSX.Element {
  const { error, reset, onFallen } = props;
  props.report("render", error);
  onFallen(reset);
  onCleanup(() => onFallen(null));

  return (
    <ErrorScreen
      theme={props.theme}
      error={error}
      logPath={props.logPath}
      reset={reset}
      quit={props.quit}
    />
  );
}
