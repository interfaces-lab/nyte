/** Login steps: provider/method choice, link with open/copy keys, masked secret input (bullets), waiting line. */
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { For, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import type { AuthDialog, AuthStep } from "../../model/dialogs/auth.ts";
import { hint, joinHints, moveHint, Note, Panel, QueryLine } from "./panel.tsx";

type Step<K extends AuthStep["kind"]> = Accessor<Extract<AuthStep, { readonly kind: K }>>;

function stepHints(step: AuthStep): string {
  const cancel = hint("auth.cancel", "cancel");

  switch (step.kind) {
    case "link":
      return joinHints([hint("auth.open", "open"), hint("auth.copy", "copy"), cancel]);
    case "secret":
      return joinHints([hint("auth.submit", "submit"), cancel]);
    case "choose":
      return joinHints([hint("auth.submit", "select"), moveHint(), cancel]);
    case "starting":
    case "waiting":
      return cancel;
    default: {
      const _exhaustive: never = step;

      return _exhaustive;
    }
  }
}

export function AuthView(props: { readonly dialog: AuthDialog }): JSX.Element {
  const app = useApp();
  const theme = app.kit.theme;

  const title = () =>
    props.dialog.mode === "login"
      ? `Sign in to ${props.dialog.provider}`
      : `Sign out of ${props.dialog.provider}`;

  return (
    <Panel title={title()} hints={stepHints(props.dialog.step)}>
      <Switch>
        <Match when={props.dialog.step.kind === "starting"}>
          <Note text="Starting…" />
        </Match>
        <Match when={props.dialog.step.kind === "link" ? props.dialog.step : null}>
          {(step: Step<"link">) => (
            <>
              <Note text="Open this link to continue:" />
              <text fg={theme().link} wrapMode="word" flexShrink={0}>
                {step().url}
              </text>
              <Show when={step().code}>
                {(code: Accessor<string>) => (
                  <text height={1} wrapMode="none" selectable={false} flexShrink={0}>
                    <span style={{ fg: theme().dim }}>Code: </span>
                    <span style={{ fg: theme().foreground, attributes: TextAttributes.BOLD }}>
                      {code()}
                    </span>
                  </text>
                )}
              </Show>
            </>
          )}
        </Match>
        <Match when={props.dialog.step.kind === "secret" ? props.dialog.step : null}>
          {(step: Step<"secret">) => (
            <>
              <Note text={step().prompt} />
              <QueryLine
                text={String.fromCodePoint(...step().codePoints)}
                caret={step().caret}
                placeholder=""
                masked={step().masked}
              />
            </>
          )}
        </Match>
        <Match when={props.dialog.step.kind === "choose" ? props.dialog.step : null}>
          {(step: Step<"choose">) => (
            <>
              <Note text={step().prompt} />
              <For each={step().options}>
                {(option, index) => {
                  const selected = () => index() === step().highlighted;

                  return (
                    <text
                      height={1}
                      width="100%"
                      wrapMode="none"
                      selectable={false}
                      flexShrink={0}
                      bg={selected() ? theme().selectionBackground : undefined}
                      fg={selected() ? theme().selectionForeground : theme().foreground}
                      attributes={selected() ? TextAttributes.BOLD : TextAttributes.NONE}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        app.dispatch({ kind: "dialog", command: { kind: "pick", index: index() } });
                      }}
                    >
                      {`${selected() ? `${GLYPHS.prompt} ` : "  "}${option.label}`}
                    </text>
                  );
                }}
              </For>
            </>
          )}
        </Match>
        <Match when={props.dialog.step.kind === "waiting" ? props.dialog.step : null}>
          {(step: Step<"waiting">) => <Note text={step().message} />}
        </Match>
      </Switch>
    </Panel>
  );
}
