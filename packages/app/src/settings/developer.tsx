import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { ORIGIN_PATTERN } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { BundledCli, HostBridge, UpdateChannel } from "../bridge.ts";
import { DESKTOP_SETTING_SCHEMAS } from "../desktop-settings.ts";
import { errorMessage } from "../errors.ts";
import { nyte } from "../nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import type { Setting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { keys } from "../query-keys.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { settings as settingsSchema } from "../theme/schema.stylex.ts";
import { APP_ORIGINS } from "../web/origins.ts";
import { available } from "./capability.ts";
import { SettingsDialog } from "./dialog.tsx";
import { SettingsRow, SettingsSection, SwitchRow, TextRow } from "./rows.tsx";

const UPDATE_CHANNEL = [
  { value: "stable", label: "Stable" },
  { value: "nightly", label: "Nightly" },
] as const;

const DEFAULT_ORIGIN = APP_ORIGINS[0];

const ORIGIN = new RegExp(ORIGIN_PATTERN);

const webOrigins = pluginSetting("desktop.webOrigins", DESKTOP_SETTING_SCHEMAS.webOrigins);

const traceEndpoint = pluginSetting("telemetry.endpoint", Type.String());

const traceEndpointRow: Setting<string | null> = {
  ...traceEndpoint,
  get: () => {
    const value = traceEndpoint.get();

    return value === "" ? null : value;
  },
  set: (value) => traceEndpoint.set(value ?? ""),
};

export function DeveloperSettings(): ReactElement {
  const developer = useSetting(preferences.developerMode);
  const updates = nyte.host.updates;
  const bundledCli = nyte.host.bundledCli;

  return (
    <>
      <SettingsSection>
        <SwitchRow
          setting={preferences.developerMode}
          title="Developer Mode"
          description="Show settings for development and debugging"
        />
      </SettingsSection>
      {developer && (
        <>
          {updates !== undefined && <UpdateChannelSection updates={updates} />}
          {bundledCli !== undefined && <BundledCliSection inspect={bundledCli} />}
          {available(["desktop"]) && <WebOriginsSection />}
          <SettingsSection title="Diagnostics">
            <TextRow
              setting={traceEndpointRow}
              type="url"
              title="Trace endpoint"
              description="Send OpenTelemetry traces of agent runs to this OTLP URL"
              placeholder="http://localhost:4318/v1/traces"
            />
          </SettingsSection>
        </>
      )}
    </>
  );
}

function UpdateChannelSection({
  updates,
}: {
  readonly updates: NonNullable<HostBridge["updates"]>;
}): ReactElement {
  const client = useQueryClient();

  const channel = useQuery({
    queryKey: keys.updateChannel,
    queryFn: () =>
      updates.channel().catch((cause: unknown) => {
        toast.add({ type: "error", title: errorMessage(cause) });
        throw cause;
      }),
  });

  const change = useMutation({
    mutationFn: (value: UpdateChannel) => updates.setChannel({ channel: value }),
    onSuccess: (value) => client.setQueryData(keys.updateChannel, value),
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  return (
    <SettingsSection title="App version">
      <SettingsRow
        title="Update channel"
        description="Nightly builds every commit on main, so expect rough edges"
      >
        <Select
          items={UPDATE_CHANNEL}
          value={channel.data ?? null}
          disabled={channel.data === undefined || change.isPending}
          onValueChange={(next) => {
            if (next !== null) change.mutate(next);
          }}
        >
          <SelectTrigger aria-label="Update channel">
            <SelectValue placeholder={channel.isError ? "Unavailable" : "Loading…"} />
          </SelectTrigger>
          <SelectContent>
            {UPDATE_CHANNEL.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsSection>
  );
}

function BundledCliSection({
  inspect,
}: {
  readonly inspect: () => Promise<BundledCli>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const cli = useQuery({ queryKey: keys.bundledCli, queryFn: inspect });

  const status: BundledCli | undefined = cli.isError
    ? { kind: "unavailable", problem: errorMessage(cli.error) }
    : cli.data;

  return (
    <SettingsSection title="Nyte CLI">
      {status === undefined ? (
        <SettingsRow title="Checking the included CLI…">{null}</SettingsRow>
      ) : status.kind === "ready" ? (
        <>
          <SettingsRow
            title={
              <StatusTitle tone="success" icon="checkmark">
                Included CLI ready
              </StatusTitle>
            }
          >
            <Button variant="text" tone="primary" onClick={() => setOpen(true)}>
              Show Details
            </Button>
          </SettingsRow>
          <SettingsDialog open={open} title="Included CLI" onOpenChange={setOpen}>
            <dl {...props(text.base, styles.details)}>
              <dt {...props(styles.detailLabel)}>Version</dt>
              <dd {...props(styles.detailValue)}>{status.version}, the same as Nyte</dd>
              <dt {...props(styles.detailLabel)}>Location</dt>
              <dd {...props(styles.detailValue)}>{status.path}</dd>
              <dt {...props(styles.detailLabel)}>Architecture</dt>
              <dd {...props(styles.detailValue)}>{architectureLabel(status.architecture)}</dd>
              <dt {...props(styles.detailLabel)}>Signed</dt>
              <dd {...props(styles.detailValue)}>{status.signature}</dd>
            </dl>
          </SettingsDialog>
        </>
      ) : (
        <SettingsRow
          title={
            <StatusTitle tone="warning" icon="warning">
              Included CLI unavailable
            </StatusTitle>
          }
          description={status.problem}
        >
          {null}
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

function StatusTitle({
  tone,
  icon,
  children,
}: {
  readonly tone: "success" | "warning";
  readonly icon: IconName;
  readonly children: string;
}): ReactElement {
  return (
    <span {...props(styles.status)}>
      <span {...props(intent[tone], styles.statusMark)}>
        <Icon name={icon} size={12} />
      </span>
      {children}
    </span>
  );
}

function architectureLabel(architecture: string): string {
  if (nyte.platform !== "darwin") return architecture;

  if (architecture === "arm64") return "Apple silicon (arm64)";

  return architecture === "x64" ? "Intel (x64)" : architecture;
}

function WebOriginsSection(): ReactElement {
  const added = useSetting(webOrigins);
  const [draft, setDraft] = useState("");
  const [tried, setTried] = useState(false);
  const origin = draft.trim().toLowerCase();
  const problem = originProblem(draft.trim(), [DEFAULT_ORIGIN, ...(added ?? [])]);

  return (
    <SettingsSection
      title="Web client origins"
      note="Browser pages at these origins can connect to this Mac while it's shared over Tailscale. app.nyte.sh is always allowed. Changes apply the next time you share."
    >
      <SettingsRow title={DEFAULT_ORIGIN}>
        <span {...props(text.base, styles.meta)}>Default</span>
      </SettingsRow>
      {(added ?? []).map((value) => (
        <SettingsRow key={value} title={value}>
          <Button
            variant="ghost"
            iconOnly
            icon="close"
            aria-label={`Remove ${value}`}
            onClick={() => webOrigins.set((added ?? []).filter((other) => other !== value))}
          />
        </SettingsRow>
      ))}
      <form
        {...props(settingsPatterns.rowRule, styles.listForm)}
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);

          if (problem !== undefined || added === undefined) return;
          webOrigins.set([...added, origin]);
          setDraft("");
          setTried(false);
        }}
      >
        <span {...props(styles.listEntry)}>
          <Input
            aria-label="Web client origin"
            aria-invalid={tried && problem !== undefined}
            placeholder="https://example.com"
            value={draft}
            spellCheck={false}
            autoCapitalize="off"
            disabled={added === undefined}
            onChange={(event) => setDraft(event.target.value)}
            xstyle={styles.listInput}
          />
          <Button type="submit" variant="outline" disabled={origin === "" || added === undefined}>
            Add Origin
          </Button>
        </span>
        {tried && problem !== undefined && (
          <span role="alert" {...props(text.sm, intent.danger, styles.listError)}>
            {problem}
          </span>
        )}
      </form>
    </SettingsSection>
  );
}

function originProblem(value: string, allowed: readonly string[]): string | undefined {
  if (!ORIGIN.test(value.toLowerCase()))
    return "Origins start with https://, like https://example.com or https://*.example.com.";

  return allowed.includes(value.toLowerCase()) ? `${value} is already allowed.` : undefined;
}

const styles = create({
  status: { display: "inline-flex", alignItems: "center", gap: space.s2, verticalAlign: "top" },
  statusMark: {
    display: "inline-flex",
    flex: "none",
    alignItems: "center",
    justifyContent: "center",
    width: space.s4,
    height: space.s4,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractiveStrong,
    color: role.contentOnInteractiveStrong,
  },
  details: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: space.s4,
    rowGap: space.s2,
    margin: 0,
  },
  detailLabel: { color: role.contentSecondary },
  detailValue: { margin: 0, color: role.contentPrimary, overflowWrap: "anywhere" },
  meta: { color: role.contentSecondary },
  listForm: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    padding: settingsSchema.rowPadding,
  },
  listEntry: { display: "flex", alignItems: "center", gap: space.s3 },
  listInput: { flex: "1 1 0", minWidth: 0 },
  listError: { color: role.contentInteractivePrimary },
});
