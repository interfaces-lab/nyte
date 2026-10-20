import { create, props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ToolClass } from "@nyte-ai/sdk";
import {
  condensedCommand,
  formatDuration,
  toolOutput,
  toolStatus,
  toolVerbs,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { appearance, motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ToolCallDensity } from "../preferences/index.ts";
import { activityStyles } from "./activity.stylex.ts";
import { terminalText } from "./terminal-text.ts";
import { ToolOutcome, toolLineStyles } from "./tool-line.tsx";

type ShellToolClass = Extract<ToolClass, { readonly kind: "shell" }>;

type ShellTokenType =
  | "whitespace"
  | "string"
  | "variable"
  | "operator"
  | "flag"
  | "command"
  | "text";

type ShellToken = { readonly type: ShellTokenType; readonly text: string };

const SHELL_TOKEN =
  /"(?:[^"\\]|\\.)*"|'[^']*'|\$\{[^}]+\}|\$\w+|&&|\|\||>>|[|;><]|--?\w[\w-]*|\s+|\S+/gu;

const SEPARATOR = /^(?:&&|\|\||[|;])$/u;

const PREVIEW_LINES = 5;

const PREVIEW_CHARS = 2000;

const MONO = {
  margin: 0,
  fontFamily: type.fontMono,
  fontSize: type.fontCode,
  lineHeight: type.leadingSm,
  letterSpacing: "normal",
  color: role.contentSecondary,
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  userSelect: "text",
} as const;

const styles = create({
  panel: { paddingTop: space.s1 },
  body: {
    position: "relative",
    overflow: "clip",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
  },
  bodyMenu: { position: "absolute", top: 6, right: 6, zIndex: 1 },
  scroll: { overflowY: "auto", overscrollBehavior: "auto" },
  scrollLine: { maxHeight: 200 },
  scrollCard: { maxHeight: "min(480px, 60vh)" },
  command: { ...MONO, display: "block", paddingBlock: space.s1_5, paddingInline: space.s2_5 },
  commandWithMenu: { paddingRight: `calc(${space.s1} + 28px)` },
  prompt: { userSelect: "none" },
  output: {
    ...MONO,
    display: "block",
    paddingTop: 0,
    paddingInline: space.s2,
    paddingBottom: space.s1_5,
  },
  facts: {
    display: "block",
    paddingInline: space.s2,
    paddingBottom: space.s1_5,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    letterSpacing: "normal",
    fontVariantNumeric: "tabular-nums",
    userSelect: "text",
  },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    marginBlock: space.s0_5,
    overflow: "clip",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    "--_icon-default": {
      default: "inline-flex",
      ":hover": { [media.hover]: "none" },
    },
    "--_icon-hover": {
      default: "none",
      ":hover": { [media.hover]: "inline-flex" },
    },
    "--_actions": {
      default: 0,
      ":hover": { [media.hover]: 1 },
      ":focus-within": 1,
    },
  },
  headerRow: { position: "relative", display: "flex", minWidth: 0 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: space.s1_5,
    paddingInlineStart: space.s2,
    paddingInlineEnd: space.s8,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  iconSwap: { display: "inline-flex", flexShrink: 0, color: role.contentTertiary },
  iconDefault: { display: "var(--_icon-default)" },
  iconHover: { display: "var(--_icon-hover)" },
  description: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  headerActions: {
    position: "absolute",
    top: "50%",
    right: 4,
    display: "flex",
    alignItems: "center",
    transform: "translateY(-50%)",
    opacity: "var(--_actions)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  cardBody: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },
  preview: {
    display: "flex",
    flexDirection: "column-reverse",
    width: "100%",
    maxHeight: `calc(${String(PREVIEW_LINES)} * ${type.leadingSm} + 6px)`,
    paddingTop: space.s1_5,
    overflow: "clip",
    cursor: appearance.cursorInteractive,
    maskImage: {
      default: null,
      "[data-overflow]": "linear-gradient(to bottom, transparent 0, black 16px)",
    },
  },
  previewText: { flexShrink: 0, width: "100%", minWidth: 0 },
});

const tokenStyles = create({
  command: { color: role.contentSecondary },
  flag: { color: role.contentSecondary },
  string: { color: role.contentSecondary },
  variable: { color: role.contentPrimary },
  operator: { color: role.contentPrimary },
  text: { color: role.contentPrimary },
});

function shellTokens(command: string): readonly ShellToken[] {
  let expectCommand = true;

  return Array.from(command.matchAll(SHELL_TOKEN), ([text]): ShellToken => {
    if (/^\s+$/u.test(text)) return { type: "whitespace", text };

    if (text.startsWith('"') || text.startsWith("'")) {
      expectCommand = false;

      return { type: "string", text };
    }

    if (text.startsWith("$")) {
      expectCommand = false;

      return { type: "variable", text };
    }

    if (SEPARATOR.test(text)) {
      expectCommand = true;

      return { type: "operator", text };
    }

    if (text.startsWith(">") || text.startsWith("<")) return { type: "operator", text };

    if (/^-\w/u.test(text)) {
      expectCommand = false;

      return { type: "flag", text };
    }

    if (expectCommand) {
      expectCommand = false;

      return { type: "command", text };
    }

    return { type: "text", text };
  });
}

function outputTail(text: string) {
  let breaks = 0;

  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== "\n") continue;
    breaks += 1;

    if (breaks === PREVIEW_LINES) {
      const tail = text.slice(index + 1);

      return { text: tail.slice(-PREVIEW_CHARS), clipped: true };
    }
  }

  return { text: text.slice(-PREVIEW_CHARS), clipped: text.length > PREVIEW_CHARS };
}

function Facts({ durationMs }: { readonly durationMs: number }): ReactElement {
  return <span {...props(styles.facts)}>{formatDuration(durationMs)}</span>;
}

function CommandCode({
  tokens,
  withMenu,
}: {
  readonly tokens: readonly ShellToken[];
  readonly withMenu: boolean;
}): ReactElement {
  return (
    <code {...props(styles.command, withMenu && styles.commandWithMenu)}>
      <span {...props(styles.prompt)}>$ </span>
      {tokens.map((token, index) =>
        token.type === "whitespace" ? (
          token.text
        ) : (
          <span
            key={index}
            {...props(
              token.type === "command" && surfaceTheme.orange,
              token.type === "flag" && surfaceTheme.teal,
              token.type === "string" && surfaceTheme.pink,
              token.type === "variable" && surfaceTheme.green,
              tokenStyles[token.type],
            )}
          >
            {token.text}
          </span>
        ),
      )}
    </code>
  );
}

function CopyCommand({ command }: { readonly command: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            icon={copied ? "checkmark" : "copy"}
            aria-label="Copy command"
            onClick={() => {
              navigator.clipboard
                .writeText(command)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
          />
        }
      />
      <TooltipContent>{copied ? "Copied" : "Copy command"}</TooltipContent>
    </Tooltip>
  );
}

function FollowScroll({
  follow,
  height,
  children,
}: {
  readonly follow: string | undefined;
  readonly height: "line" | "card";
  readonly children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;

    if (follow === undefined || element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [follow]);

  return (
    <div
      ref={ref}
      data-nyte-scrollport
      {...props(styles.scroll, height === "line" ? styles.scrollLine : styles.scrollCard)}
    >
      {children}
    </div>
  );
}

function OutputPreview({ output }: { readonly output: string }): ReactElement {
  const rootRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const tail = outputTail(output);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const text = textRef.current;

    if (root === null || text === null) return undefined;

    const sync = (): void => {
      root.toggleAttribute("data-overflow", tail.clipped || root.scrollHeight > root.clientHeight);
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(text);

    return () => observer.disconnect();
  }, [tail.clipped]);

  return (
    <Collapsible.Trigger
      ref={rootRef}
      variant="plain"
      aria-label="Show full command output"
      xstyle={[styles.cardBody, styles.preview, focus.ringInset]}
    >
      <span ref={textRef} {...props(styles.output, styles.previewText)}>
        {tail.text}
      </span>
    </Collapsible.Trigger>
  );
}

export const ShellCallView = memo(function ShellCallView({
  message,
  toolClass,
  cwd,
  density,
}: {
  readonly message: ToolMessage;
  readonly toolClass: ShellToolClass;
  readonly cwd: string | undefined;
  readonly density: ToolCallDensity;
}): ReactElement {
  const status = toolStatus(message);
  const running = status.tense === "running";
  const [open, setOpen] = useState(false);
  const { state } = message;

  const raw = running
    ? state.phase === "running"
      ? (state.progress?.text ?? "")
      : ""
    : toolOutput(state);

  const durationMs =
    message.status.kind === "settled" ? message.status.endedAt - message.at : undefined;

  const output = useMemo(() => terminalText(raw).trim(), [raw]);
  const tokens = useMemo(() => shellTokens(toolClass.command), [toolClass.command]);
  const description = toolClass.description?.trim() ?? "";

  const label =
    description === ""
      ? condensedCommand(toolClass.command, cwd)
      : `${description.charAt(0).toUpperCase()}${description.slice(1)}`;

  const verb =
    status.tense === "none" || description !== "" ? undefined : toolVerbs(toolClass)[status.tense];

  const heading = verb === undefined ? label : `${verb} ${label}`;
  const follow = running ? output : undefined;

  const body = (withMenu: boolean): ReactElement => (
    <>
      <CommandCode tokens={tokens} withMenu={withMenu} />
      {output !== "" && <pre {...props(styles.output)}>{output}</pre>}
      {durationMs !== undefined && <Facts durationMs={durationMs} />}
    </>
  );

  if (density === "detailed") {
    return (
      <Collapsible.Root open={open} onOpenChange={setOpen} xstyle={styles.card}>
        <div {...props(styles.headerRow)}>
          <Collapsible.Trigger
            variant="plain"
            xstyle={[
              text.base,
              styles.header,
              status.tone === "stopped" && toolLineStyles.dimmedText,
              focus.ringInset,
            ]}
          >
            <span aria-hidden="true" {...props(styles.iconSwap)}>
              <span {...props(styles.iconDefault)}>
                <Icon name="console" size={14} />
              </span>
              <span {...props(styles.iconHover)}>
                <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
              </span>
            </span>
            <span {...props(styles.description, running && activityStyles.shimmer)}>{heading}</span>
            <ToolOutcome status={status} />
          </Collapsible.Trigger>
          <span {...props(styles.headerActions)}>
            <CopyCommand command={toolClass.command} />
          </span>
        </div>
        {open ? (
          <div data-tool-body role="region" aria-label="Command output" {...props(styles.cardBody)}>
            <FollowScroll follow={follow} height="card">
              {body(false)}
            </FollowScroll>
          </div>
        ) : (
          output !== "" && <OutputPreview output={output} />
        )}
      </Collapsible.Root>
    );
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} xstyle={toolLineStyles.root}>
      <Collapsible.Trigger
        variant="plain"
        xstyle={[
          toolLineStyles.line,
          toolLineStyles.clickable,
          status.tone === "stopped" && toolLineStyles.dimmed,
          focus.ringInset,
        ]}
      >
        {verb !== undefined && (
          <span {...props(toolLineStyles.action, running && activityStyles.shimmer)}>{verb}</span>
        )}
        <span {...props(toolLineStyles.details)}>{label}</span>
        <ToolOutcome status={status} />
        <Collapsible.Chevron size={12} xstyle={toolLineStyles.chevron} />
      </Collapsible.Trigger>
      <Collapsible.Panel
        data-tool-body
        role="region"
        aria-label="Command output"
        xstyle={styles.panel}
      >
        <div {...props(styles.body)}>
          <span {...props(styles.bodyMenu)}>
            <CopyCommand command={toolClass.command} />
          </span>
          <FollowScroll follow={follow} height="line">
            {body(true)}
          </FollowScroll>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
});
