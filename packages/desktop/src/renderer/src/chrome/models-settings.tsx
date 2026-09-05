/**
 * Settings › Models: what a new chat starts with, which providers are on and
 * connected, and which of their models the picker shows. Every row states
 * where it stands first and offers the one action that changes that.
 */
import { Input } from "@nyte-ai/ui";
import { Collapsible } from "@nyte-ai/ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import type { ThinkingLevel } from "@nyte-ai/core";
import { Icon, type IconName } from "../components/icons.tsx";
import { Button, focus } from "../components/ui.tsx";
import {
  formatContextWindow,
  formatPricing,
  THINKING_LABELS,
  thinkingLevelsFor,
} from "../conversation/model-picker-state.ts";
import { nyte } from "../nyte.ts";
import type { DesktopCatalog, ProviderStatus } from "../nyte.ts";
import { useCatalog, useSetPreference } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { SettingsRow, SettingsSelect, SettingsSwitch } from "./settings-controls.tsx";

type LoginMethod = Parameters<typeof nyte.host.login>[0]["method"];

function providerIcon(providerId: string): IconName {
  if (providerId === "anthropic") return "model-anthropic";
  if (providerId === "openai" || providerId === "openai-codex") return "model-openai";
  if (providerId === "opencode" || providerId === "opencode-go") return "provider-opencode";
  return "model-generic";
}

function DefaultsSection({ catalog }: { catalog: DesktopCatalog }): ReactElement {
  const setPreference = useSetPreference();
  const providerNames = new Map(catalog.providers.map((provider) => [provider.id, provider.name]));
  const listed = catalog.models.filter((option) => option.listed);
  const chosen = catalog.models.find(
    (option) =>
      option.provider === catalog.defaults.model.provider &&
      option.id === catalog.defaults.model.id,
  );
  // Before any login the default is a placeholder no one can switch away from;
  // the select still names it so the composer's chip and this row agree.
  const candidates = chosen !== undefined && !chosen.listed ? [chosen, ...listed] : listed;
  const levels = thinkingLevelsFor(chosen);

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <h2 {...stylex.props(settingsPatterns.sectionTitle)}>New chats</h2>
      <div {...stylex.props(settingsPatterns.group)}>
        <SettingsRow
          title="Model"
          controlWidth="wide"
          description={
            listed.length === 0
              ? "Connect a provider below to choose one"
              : "Switch models any time from the composer"
          }
        >
          <SettingsSelect
            label="Default model"
            width="wide"
            value={chosen?.key ?? ""}
            disabled={candidates.length <= 1 || setPreference.isPending}
            options={candidates.map((option) => ({
              value: option.key,
              label: `${option.name} · ${providerNames.get(option.provider) ?? option.provider}`,
            }))}
            onValueChange={(key) => {
              const option = candidates.find((candidate) => candidate.key === key);
              if (option === undefined) return;
              setPreference.mutate({
                kind: "defaults",
                model: { provider: option.provider, id: option.id },
              });
            }}
          />
        </SettingsRow>
        <SettingsRow title="Reasoning" description="How long the model thinks before it answers">
          <SettingsSelect<ThinkingLevel>
            label="Default reasoning"
            value={catalog.defaults.thinkingLevel}
            disabled={levels.length <= 1 || setPreference.isPending}
            options={levels.map((level) => ({ value: level, label: THINKING_LABELS[level] }))}
            onValueChange={(thinkingLevel) =>
              setPreference.mutate({ kind: "defaults", thinkingLevel })
            }
          />
        </SettingsRow>
      </div>
    </section>
  );
}

function ApiKeyForm({
  label,
  pending,
  onSubmit,
  onCancel,
}: {
  label: string;
  pending: boolean;
  onSubmit: (key: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [key, setKey] = useState("");
  return (
    <form
      {...stylex.props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim() !== "") onSubmit(key.trim());
      }}
    >
      <div {...stylex.props(styles.keyRow)}>
        <Input
          unstyled
          type="password"
          aria-label={label}
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder={`Paste your ${label}`}
          value={key}
          disabled={pending}
          {...stylex.props(styles.keyInput)}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={pending || key.trim() === ""}>
          Save
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <span {...stylex.props(styles.keyHint)}>Stored on this Mac in ~/.nyte/auth.json</span>
    </form>
  );
}

function ProviderRow({ provider }: { provider: ProviderStatus }): ReactElement {
  const setPreference = useSetPreference();
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const login = useMutation({
    mutationFn: (method: LoginMethod) => nyte.host.login({ provider: provider.id, method }),
    onSuccess: () => {
      setKeyFormOpen(false);
      toast.success(`Connected to ${provider.name}`);
    },
    onError: () => toast.error(`Couldn't sign in to ${provider.name}. Try again.`),
  });
  const logout = useMutation({
    mutationFn: () => nyte.host.logout({ provider: provider.id }),
    onSuccess: () => toast.success(`Signed out of ${provider.name}`),
    onError: () => toast.error(`Couldn't sign out of ${provider.name}. Try again.`),
  });
  const busy = login.isPending || logout.isPending;
  const browser = provider.signIn.find((method) => method.kind === "browser");
  const apiKey = provider.signIn.find((method) => method.kind === "api_key");
  const { connection } = provider;

  const status =
    login.isPending && login.variables.kind === "browser" ? (
      <ConnectionStatus tone="warn">Waiting for the browser</ConnectionStatus>
    ) : !provider.enabled ? (
      <ConnectionStatus tone="off">Off</ConnectionStatus>
    ) : connection.kind === "disconnected" ? (
      <ConnectionStatus tone="off">Not connected</ConnectionStatus>
    ) : (
      <ConnectionStatus tone="on">Connected</ConnectionStatus>
    );

  const detail =
    connection.kind === "oauth"
      ? `Signed in with ${browser?.subscription ?? "your subscription"}`
      : connection.kind === "api_key"
        ? connection.env === undefined
          ? "API key"
          : `API key from ${connection.env}`
        : browser !== undefined && apiKey !== undefined
          ? `Sign in with ${browser.subscription}, or add an API key`
          : apiKey !== undefined
            ? "Add an API key to connect"
            : browser !== undefined
              ? "Sign in to connect"
              : "Connects through the environment";

  // A key from the environment is not ours to remove.
  const canSignOut =
    connection.kind === "oauth" || (connection.kind === "api_key" && connection.env === undefined);

  return (
    <ConnectionRow
      glyph={<Icon name={providerIcon(provider.id)} size={20} />}
      title={provider.name}
      detail={detail}
      dimmed={!provider.enabled}
      status={status}
      actions={
        connection.kind === "disconnected" ? (
          <>
            {browser !== undefined && (
              <Button disabled={busy} onClick={() => login.mutate({ kind: "browser" })}>
                {browser.label}
              </Button>
            )}
            {apiKey !== undefined && (
              <Button
                variant="ghost"
                icon="key"
                disabled={busy}
                aria-expanded={keyFormOpen}
                onClick={() => {
                  login.reset();
                  setKeyFormOpen((open) => !open);
                }}
              >
                Add API key
              </Button>
            )}
          </>
        ) : canSignOut ? (
          <Button variant="ghost" disabled={busy} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        ) : undefined
      }
      trailing={
        <SettingsSwitch
          label={`${provider.name} on`}
          checked={provider.enabled}
          disabled={setPreference.isPending}
          onCheckedChange={(enabled) =>
            setPreference.mutate({ kind: "provider", provider: provider.id, enabled })
          }
        />
      }
      expansion={
        keyFormOpen && apiKey !== undefined ? (
          <ApiKeyForm
            label={apiKey.label}
            pending={login.isPending}
            onSubmit={(key) => login.mutate({ kind: "api_key", key })}
            onCancel={() => {
              login.reset();
              setKeyFormOpen(false);
            }}
          />
        ) : undefined
      }
    />
  );
}

function PickerModelsSection({ catalog }: { catalog: DesktopCatalog }): ReactElement {
  const setPreference = useSetPreference();
  const [query, setQuery] = useState("");
  const [expandedProviders, setExpandedProviders] = useState<ReadonlySet<string>>(new Set());
  const needle = query.trim().toLowerCase();
  const enabled = catalog.providers.filter((provider) => provider.enabled);
  const groups = enabled.flatMap((provider) => {
    const all = catalog.models.filter((option) => option.provider === provider.id);
    const matching = all.filter((option) =>
      `${option.name}\n${option.id}`.toLowerCase().includes(needle),
    );
    return matching.length === 0 ? [] : [{ provider, all, matching }];
  });

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <h2 {...stylex.props(settingsPatterns.sectionTitle)}>In the picker</h2>
      <p {...stylex.props(settingsPatterns.sectionDescription)}>
        Hide the models you never use. Hidden models stay here to turn back on.
      </p>
      {enabled.length > 0 && (
        <label {...stylex.props(styles.search)}>
          <Icon name="search" size={13} />
          <Input
            unstyled
            type="search"
            aria-label="Search models"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search models"
            value={query}
            {...stylex.props(styles.searchInput)}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {enabled.length === 0 && (
        <div {...stylex.props(styles.quiet)}>Turn on a provider to choose its models.</div>
      )}
      {enabled.length > 0 && groups.length === 0 && (
        <div {...stylex.props(styles.quiet)}>No models match.</div>
      )}
      {groups.map(({ provider, all, matching }) => {
        const shown = all.filter((option) => !option.hidden).length;
        const setAll = (hidden: boolean): void =>
          setPreference.mutate({
            kind: "models",
            provider: provider.id,
            ids: all.map((option) => option.id),
            hidden,
          });
        const heading = (
          <>
            <Icon
              name={
                needle !== "" || expandedProviders.has(provider.id)
                  ? "chevron-down"
                  : "chevron-right"
              }
              size={12}
            />
            <span {...stylex.props(styles.groupTitle)}>{provider.name}</span>
            <span {...stylex.props(styles.groupMeta)}>
              {shown} of {all.length} shown
              {provider.connection.kind === "disconnected" && " · Not connected"}
            </span>
          </>
        );
        return (
          <Collapsible.Root
            key={provider.id}
            open={needle !== "" || expandedProviders.has(provider.id)}
            onOpenChange={(open) =>
              setExpandedProviders((previous) => {
                const next = new Set(previous);
                if (open) next.add(provider.id);
                else next.delete(provider.id);
                return next;
              })
            }
            {...stylex.props(settingsPatterns.group)}
          >
            <div {...stylex.props(styles.groupHeading)}>
              {needle === "" ? (
                <Collapsible.Trigger
                  aria-label={`${provider.name} models`}
                  {...stylex.props(styles.groupLabel, styles.groupTrigger, focus.ringInset)}
                >
                  {heading}
                </Collapsible.Trigger>
              ) : (
                <span {...stylex.props(styles.groupLabel)}>{heading}</span>
              )}
              <span {...stylex.props(styles.groupActions)}>
                <Button
                  variant="ghost"
                  disabled={shown === all.length || setPreference.isPending}
                  onClick={() => setAll(false)}
                >
                  Show all
                </Button>
                <Button
                  variant="ghost"
                  disabled={shown === 0 || setPreference.isPending}
                  onClick={() => setAll(true)}
                >
                  Hide all
                </Button>
              </span>
            </div>
            <Collapsible.Panel {...stylex.props(styles.groupPanel)}>
              {matching.map((option) => (
                <div key={option.key} {...stylex.props(styles.modelRow)}>
                  <span {...stylex.props(styles.modelBody)}>
                    <span {...stylex.props(styles.modelName)}>{option.name}</span>
                    <span
                      title="Context window · price per million tokens, input / output"
                      {...stylex.props(styles.modelMeta)}
                    >
                      {formatContextWindow(option.contextWindow)} · {formatPricing(option.cost)}
                    </span>
                  </span>
                  <SettingsSwitch
                    label={`Show ${option.name}`}
                    checked={!option.hidden}
                    disabled={setPreference.isPending}
                    onCheckedChange={(show) =>
                      setPreference.mutate({
                        kind: "models",
                        provider: provider.id,
                        ids: [option.id],
                        hidden: !show,
                      })
                    }
                  />
                </div>
              ))}
            </Collapsible.Panel>
          </Collapsible.Root>
        );
      })}
    </section>
  );
}

export function ModelsSettings(): ReactElement | null {
  const catalog = useCatalog();
  if (catalog.data === undefined) {
    if (!catalog.isError) return null;
    return (
      <div role="alert" title={catalog.error.message} {...stylex.props(styles.alert)}>
        Couldn&rsquo;t load providers. Try again.
      </div>
    );
  }
  return (
    <>
      <DefaultsSection catalog={catalog.data} />
      <section {...stylex.props(settingsPatterns.section)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Providers</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          The picker shows models from providers that are on and connected.
        </p>
        <ConnectionList>
          {catalog.data.providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} />
          ))}
        </ConnectionList>
      </section>
      <PickerModelsSection catalog={catalog.data} />
    </>
  );
}
