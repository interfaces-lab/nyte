import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { McpChange, McpServerView, ValidationIssue, WorkspaceId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Switch } from "@nyte-ai/ui/switch";
import { toast } from "@nyte-ai/ui/toast";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { connection } from "../sdk.tsx";
import { ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import {
  Chips,
  Details,
  ExpandButton,
  Field,
  Notice,
  PathActions,
  Section,
  Wide,
} from "./customize-parts.tsx";
import { customizeStyles as styles } from "./customize.stylex.ts";
import { cancelLogin, runLogin, useLoginAttempt } from "./login-attempts.ts";
import { BrowserSignInPanel } from "./sign-in-panels.tsx";

export function mcpNeedsAttention(server: McpServerView): boolean {
  return server.state.kind === "needs-sign-in" || server.state.kind === "failed";
}

async function applied(change: Promise<McpChange>): Promise<void> {
  const outcome = await change;

  if (outcome.kind === "invalid") throw new Error(outcome.message);

  if (outcome.kind === "missing") throw new Error("It's no longer in mcp.json.");
}

function serverStatus(server: McpServerView): ReactNode {
  switch (server.state.kind) {
    case "disabled":
      return <ConnectionStatus tone="off">Off</ConnectionStatus>;
    case "connecting":
      return <ConnectionStatus tone="off">Connecting…</ConnectionStatus>;
    case "connected":
      return (
        <>
          <ConnectionStatus tone="on">Connected</ConnectionStatus>
          {` · ${String(server.state.tools.length)} ${server.state.tools.length === 1 ? "tool" : "tools"}`}
        </>
      );
    case "needs-sign-in":
      return <ConnectionStatus tone="warn">Needs sign-in</ConnectionStatus>;
    case "failed":
      return <ConnectionStatus tone="err">Couldn&rsquo;t connect</ConnectionStatus>;
    default: {
      const exhaustive: never = server.state;

      return exhaustive;
    }
  }
}

function McpServerRow({
  workspace,
  server,
}: {
  readonly workspace: WorkspaceId;
  readonly server: McpServerView;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const login = `mcp:${workspace}:${server.name}`;
  const attempt = useLoginAttempt(login);
  const { state } = server;

  const signIn = useMutation({
    mutationFn: () =>
      runLogin(login, { kind: "browser" }, () =>
        connection().workspace(workspace).mcp.login(server.name),
      ),
    onError: (error) =>
      toast.add({
        type: "error",
        title: `Couldn't sign in to ${server.name}. Try again.`,
        description: error.message,
      }),
  });

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      applied(connection().workspace(workspace).mcp.setEnabled(server.name, enabled)),
    onError: (error, enabled) =>
      toast.add({
        type: "error",
        title: `Couldn't turn ${server.name} ${enabled ? "on" : "off"}`,
        description: error.message,
      }),
  });

  const reconnect = useMutation({
    mutationFn: () => applied(connection().workspace(workspace).mcp.reconnect(server.name)),
    onError: (error) =>
      toast.add({
        type: "error",
        title: `Couldn't reconnect ${server.name}`,
        description: error.message,
      }),
  });

  const tools = state.kind === "connected" ? state.tools.map((tool) => tool.name) : [];

  return (
    <ConnectionRow
      glyph={<Icon name="mcp" size={16} />}
      title={server.name}
      detail={serverStatus(server)}
      control={
        <span {...props(styles.controls)}>
          {attempt !== undefined ? (
            <Button
              variant="outline"
              loading={attempt.cancelling}
              onClick={() => cancelLogin(login)}
            >
              Cancel
            </Button>
          ) : (
            state.kind === "needs-sign-in" && (
              <Button variant="outline" loading={signIn.isPending} onClick={() => signIn.mutate()}>
                Sign In
                <span {...props(srOnly)}> to {server.name}</span>
              </Button>
            )
          )}
          <ExpandButton name={server.name} open={open} onToggle={() => setOpen((was) => !was)} />
          <Switch
            label={server.name}
            checked={setEnabled.isPending ? setEnabled.variables : state.kind !== "disabled"}
            disabled={setEnabled.isPending}
            onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
          />
        </span>
      }
      expansion={
        attempt?.browser !== undefined ? (
          <BrowserSignInPanel login={login} browser={attempt.browser} />
        ) : open ? (
          <Details>
            {server.description !== null && <Wide>{server.description}</Wide>}
            {state.kind === "failed" && (
              <Wide>
                <pre {...props(styles.trace)}>
                  {state.stderr === null ? state.message : `${state.message}\n\n${state.stderr}`}
                </pre>
              </Wide>
            )}
            {tools.length > 0 && (
              <Field label={tools.length === 1 ? "Tool" : "Tools"}>
                <Chips names={tools} label={`${server.name} tools`} />
              </Field>
            )}
            <Field label="Defined in">
              <PathActions path={server.path} />
            </Field>
            {state.kind !== "disabled" && (
              <Wide>
                <Button
                  variant="outline"
                  icon="refresh"
                  loading={reconnect.isPending}
                  onClick={() => reconnect.mutate()}
                >
                  Reconnect
                </Button>
              </Wide>
            )}
          </Details>
        ) : undefined
      }
    />
  );
}

function IssueRow({ issue }: { readonly issue: ValidationIssue }): ReactElement {
  return (
    <ConnectionRow
      glyph={
        <span {...props(intent.danger, styles.failed)}>
          <Icon name="circle-x" size={16} />
        </span>
      }
      title={issue.message}
      detail={issue.source?.file}
    />
  );
}

export function McpServersTab({
  workspace,
  servers,
  issues,
  term,
}: {
  readonly workspace: WorkspaceId;
  readonly servers: readonly McpServerView[];
  readonly issues: readonly ValidationIssue[];
  readonly term: string;
}): ReactElement {
  if (servers.length === 0 && issues.length === 0)
    return term === "" ? (
      <Notice>No MCP servers yet. Add one under mcpServers in ~/.nyte/mcp.json.</Notice>
    ) : (
      <Notice>No MCP servers match &ldquo;{term}&rdquo;</Notice>
    );

  return (
    <Section title="Servers" description="From ~/.nyte/mcp.json and this folder's .nyte/mcp.json">
      {issues.map((issue) => (
        <IssueRow key={`${issue.source?.file ?? ""}:${issue.path.join(".")}`} issue={issue} />
      ))}
      {servers.map((server) => (
        <McpServerRow key={server.name} workspace={workspace} server={server} />
      ))}
    </Section>
  );
}
