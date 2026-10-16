import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import type { AuthDialog, AuthLink, AuthStep } from "../../model/dialogs/auth.ts";
import { Spinner } from "../chrome/spinner.tsx";
import { revealRow } from "./list.tsx";
import { hint, joinHints, moveHint, Note, Panel, QueryLine, useRowCap } from "./panel.tsx";

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

function Prompt(props: { readonly text: string }): JSX.Element {
  const { kit } = useApp();

  return (
    <text fg={kit.theme().foreground} wrapMode="word" selectable={false} flexShrink={0}>
      {props.text}
    </text>
  );
}

function Waiting(props: { readonly text: string }): JSX.Element {
  const { kit } = useApp();

  return (
    <box flexDirection="row" gap={1} height={1} flexShrink={0}>
      <Spinner color={kit.theme().dim} />
      <text fg={kit.theme().dim} wrapMode="none" selectable={false}>
        {props.text}
      </text>
    </box>
  );
}

function LinkLines(props: { readonly link: AuthLink; readonly intro: string }): JSX.Element {
  const { kit } = useApp();

  return (
    <>
      <Show when={props.link.code}>
        {(code: Accessor<string>) => (
          <text height={1} wrapMode="none" selectable={false} flexShrink={0}>
            <span style={{ fg: kit.theme().dim }}>Code </span>
            <span style={{ fg: kit.theme().foreground, attributes: TextAttributes.BOLD }}>
              {code()}
            </span>
          </text>
        )}
      </Show>
      <Note text={props.intro} />
      <text fg={kit.theme().link} wrapMode="char" flexShrink={0}>
        {props.link.url}
      </text>
    </>
  );
}

export function AuthView(props: { readonly dialog: AuthDialog }): JSX.Element {
  const app = useApp();
  const theme = app.kit.theme;
  const cap = useRowCap();
  let scroll: ScrollBoxRenderable | undefined;
  const highlighted = () =>
    props.dialog.step.kind === "choose" ? props.dialog.step.highlighted : 0;

  createEffect(on(highlighted, (index) => revealRow(scroll, index)));

  const title = () =>
    props.dialog.mode === "login"
      ? `Sign in to ${props.dialog.name}`
      : `Sign out of ${props.dialog.name}`;

  return (
    <Panel title={title()} hints={stepHints(props.dialog.step)}>
      <Switch>
        <Match when={props.dialog.step.kind === "starting"}>
          <Waiting text={props.dialog.mode === "login" ? "Starting sign-in…" : "Signing out…"} />
        </Match>
        <Match when={props.dialog.step.kind === "link" ? props.dialog.step : null}>
          {(step: Step<"link">) => (
            <>
              <Prompt
                text={
                  step().code === null
                    ? "Continue in your browser."
                    : "Enter this code in your browser."
                }
              />
              <LinkLines link={step()} intro="If your browser didn't open, visit:" />
            </>
          )}
        </Match>
        <Match when={props.dialog.step.kind === "secret" ? props.dialog.step : null}>
          {(step: Step<"secret">) => (
            <>
              <Prompt text={step().prompt} />
              <QueryLine
                marker
                text={String.fromCodePoint(...step().codePoints)}
                caret={step().caret}
                anchor={step().anchor}
                placeholder={step().masked ? "paste here" : "type or paste here"}
                masked={step().masked}
              />
              <Show when={props.dialog.link}>
                {(link: Accessor<AuthLink>) => (
                  <LinkLines link={link()} intro="If your browser didn't open, visit:" />
                )}
              </Show>
            </>
          )}
        </Match>
        <Match when={props.dialog.step.kind === "choose" ? props.dialog.step : null}>
          {(step: Step<"choose">) => (
            <>
              <Prompt text={step().prompt} />
              <scrollbox
                ref={(box) => {
                  scroll = box;
                  const reveal = () => revealRow(box, highlighted());
                  box.viewport.on("resize", reveal);
                  onCleanup(() => box.viewport.off("resize", reveal));
                }}
                height={Math.min(step().options.length, cap())}
                scrollX={false}
                scrollY
                scrollbarOptions={{ visible: false }}
              >
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
                          app.dispatch({
                            kind: "dialog",
                            command: { kind: "pick", index: index() },
                          });
                        }}
                      >
                        {`${selected() ? `${GLYPHS.prompt} ` : "  "}${option.label}`}
                      </text>
                    );
                  }}
                </For>
              </scrollbox>
            </>
          )}
        </Match>
        <Match when={props.dialog.step.kind === "waiting" ? props.dialog.step : null}>
          {(step: Step<"waiting">) => <Waiting text={step().message} />}
        </Match>
      </Switch>
    </Panel>
  );
}
