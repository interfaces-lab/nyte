import { Button } from "@nyte-ai/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { toast } from "@nyte-ai/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ReactElement } from "react";
import type { HostBridge, UpdateChannel } from "../bridge.ts";
import { modifierKeyLabel } from "../conversation/composer-keys.ts";
import { hostSetting, preferences, useSetting } from "../preferences/index.ts";
import { SelectRow, SettingsRow, SettingsSection, SwitchRow } from "./rows.tsx";
import { settingsStyles as styles } from "./settings.stylex.ts";
import { nyte } from "../nyte.ts";
import { keys } from "../query-keys.ts";
import { errorMessage } from "../errors.ts";

const STARTUP = [
  { value: "new-chat", label: "New chat" },
  { value: "last-session", label: "Last chat" },
] as const;

const RUNNING_MESSAGE = [
  { value: "steer", label: "Steer" },
  { value: "queue", label: "Queue" },
] as const;

const LINK_TARGET = [
  { value: "built-in", label: "Built-in browser" },
  { value: "external", label: "External browser" },
] as const;

const WORKSPACE_TRUST = [
  { value: "ask", label: "Ask first" },
  { value: "always", label: "Always load" },
  { value: "never", label: "Never load" },
] as const;

const UPDATE_CHANNEL = [
  { value: "stable", label: "Stable" },
  { value: "nightly", label: "Nightly" },
] as const;

function UpdateChannelSettings({
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
    <SettingsSection title="Updates">
      <SettingsRow
        title="Update channel"
        description="Nightly downloads updates in the background and installs them when you quit"
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

function TrustedSitesRow(): ReactElement {
  const hosts = useSetting(preferences.trustedLinkHosts);

  return (
    <SettingsRow
      title="Trusted sites"
      description="Sites you chose Always Open for. They skip the prompt"
    >
      <span {...props(text.base, styles.rowValue)}>
        {hosts.length === 1 ? "1 site" : `${String(hosts.length)} sites`}
      </span>
      <Button
        variant="outline"
        disabled={hosts.length === 0}
        onClick={() => preferences.trustedLinkHosts.set([])}
      >
        Clear
      </Button>
    </SettingsRow>
  );
}

export function GeneralSettings(): ReactElement {
  const modifier = modifierKeyLabel(nyte.platform === "darwin");
  const updates = nyte.host.updates;

  return (
    <>
      <SettingsSection title="Startup">
        <SelectRow
          setting={preferences.startupDestination}
          title="Window restoration"
          description="Open a new chat, or return to the chat you had open"
          options={STARTUP}
        />
      </SettingsSection>
      <SettingsSection title="Chat">
        <SelectRow
          setting={preferences.runningMessage}
          title="Messages while running"
          description={`What Enter does while the agent works. ${modifier}Enter does the other`}
          options={RUNNING_MESSAGE}
        />
      </SettingsSection>
      <SettingsSection title="Links">
        <SelectRow
          setting={preferences.linkTarget}
          title="Open links in"
          description="Built-in opens the page in a tab beside the chat"
          options={LINK_TARGET}
          needs={["browser"]}
        />
        <SwitchRow
          setting={preferences.confirmExternalLinks}
          title="Ask before opening links"
          description="Confirm before a chat link opens in your default browser"
        />
        <TrustedSitesRow />
      </SettingsSection>
      <SettingsSection title="Folders">
        <SelectRow
          setting={hostSetting("workspaceTrust")}
          title="A folder's own plugins and skills"
          description="Found under .nyte, .agents, or .claude. Loading them runs their code. Never load still lets Nyte work in the folder"
          options={WORKSPACE_TRUST}
        />
      </SettingsSection>
      <SettingsSection title="System">
        <SwitchRow
          setting={hostSetting("keepAwake")}
          title="Keep awake while working"
          description="Stop the computer from sleeping while a chat is working. The display can still turn off"
        />
        <SwitchRow
          setting={hostSetting("pauseOnSleep")}
          title="Pause agents while asleep"
          description="Stop model requests while the computer sleeps. Chats continue when it wakes"
        />
      </SettingsSection>
      {updates !== undefined && <UpdateChannelSettings updates={updates} />}
    </>
  );
}
