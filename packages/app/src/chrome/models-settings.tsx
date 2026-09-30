/**
 * Settings › Providers: connections, model defaults, and enabled models.
 */
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Row } from "@nyte-ai/ui/row";
import type { ModelThinkingLevel } from "@nyte-ai/schema";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Select } from "@nyte-ai/ui/select";
import { Switch } from "@nyte-ai/ui/switch";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import {
  formatContextWindow,
  formatPricing,
  THINKING_LABELS,
  thinkingLevelsFor,
} from "../conversation/model-picker-state.ts";
import { nyte } from "../nyte.ts";
import type { DesktopCatalog, ProviderStatus } from "../nyte.ts";
import type { LoginMethod } from "../bridge.ts";
import { useCatalog, useSetPreference } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import {
  beginLoginAttempt,
  endLoginAttempt,
  newLoginAttemptId,
  setLoginAttemptCancelling,
  useLoginAttempt,
} from "./login-attempts.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { SettingsRow } from "./settings-controls.tsx";
import { BrowserSignInPanel, DeviceCodePanel } from "./sign-in-panels.tsx";

type CatalogDefaults = NonNullable<DesktopCatalog["defaults"]>;

const popularProviders = [
  { id: "opencode-go", description: "Low-cost subscription for everyday use", recommended: true },
  {
    id: "opencode",
    description: "Curated models including Claude, GPT, Gemini, and more",
    recommended: true,
  },
  {
    id: "github-copilot",
    description: "Coding models through your GitHub Copilot subscription",
    recommended: false,
  },
  { id: "google", description: "Gemini models from Google", recommended: false },
  { id: "anthropic", description: "Claude models from Anthropic", recommended: false },
  { id: "openai", description: "GPT and reasoning models from OpenAI", recommended: false },
  {
    id: "openai-codex",
    description: "Codex through your ChatGPT subscription",
    recommended: false,
  },
  {
    id: "openrouter",
    description: "Models from multiple providers through one API",
    recommended: false,
  },
];

function providerIcon(providerId: string): IconName {
  if (providerId === "anthropic") return "model-anthropic";

  if (providerId === "openai" || providerId === "openai-codex") return "model-openai";

  if (providerId === "opencode" || providerId === "opencode-go") return "provider-opencode";

  if (providerId === "github-copilot") return "github";

  return "model-generic";
}

function DefaultsSection({
  catalog,
  defaults,
}: {
  catalog: DesktopCatalog;
  defaults: CatalogDefaults;
}): ReactElement {
  const setPreference = useSetPreference();
  const providerNames = new Map(catalog.providers.map((provider) => [provider.id, provider.name]));
  const listed = catalog.models.filter((option) => option.listed);

  const chosen = catalog.models.find(
    (option) => option.provider === defaults.model.provider && option.id === defaults.model.id,
  );

  // Keep a hidden or disabled default visible until the user chooses a listed model.
  const candidates = chosen !== undefined && !chosen.listed ? [chosen, ...listed] : listed;
  const levels = thinkingLevelsFor(chosen);

  return (
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>New chats</h2>
      </div>
      <div {...props(settingsPatterns.group)}>
        <SettingsRow
          title="Model"
          controlWidth="wide"
          description={
            listed.length === 0
              ? "Connect a provider below to choose one"
              : "Switch models any time from the composer"
          }
        >
          <Select
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
          <Select<ModelThinkingLevel>
            label="Default reasoning"
            value={defaults.thinkingLevel}
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
      {...props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (key.trim() !== "") onSubmit(key.trim());
      }}
    >
      <div {...props(styles.keyRow)}>
        <Input
          variant="quiet"
          type="password"
          aria-label={label}
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder={`Paste your ${label}`}
          value={key}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setKey}
        />
        <Button type="submit" variant="inverse" disabled={pending || key.trim() === ""}>
          Save
        </Button>
        <Button disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <span {...props(styles.keyHint)}>
        {nyte.clientSurface === "web"
          ? "Stored on the machine running the server"
          : "Stored on this Mac in ~/.nyte/auth.json"}
      </span>
    </form>
  );
}

function ProviderRow({ provider }: { provider: ProviderStatus }): ReactElement {
  const setPreference = useSetPreference();
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const running = useLoginAttempt(provider.id);
  // Once the catalog reports the connection, the attempt is only winding down.
  const attempt = provider.connection.kind === "disconnected" ? running : undefined;

  const login = useMutation({
    mutationFn: async (method: LoginMethod) => {
      const id = newLoginAttemptId();
      beginLoginAttempt({ provider: provider.id, attempt: id, method: method.kind });

      try {
        return await nyte.host.login({ provider: provider.id, method, attempt: id });
      } finally {
        endLoginAttempt(provider.id, id);
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "cancelled") return;
      setKeyFormOpen(false);
      if (!provider.enabled)
        setPreference.mutate({ kind: "provider", provider: provider.id, enabled: true });

      if (outcome.catalogRefreshed) toast.success(`Connected to ${provider.name}`);
      else
        toast.warning(
          `Connected to ${provider.name}, but its model list couldn't be updated. Sign out and in again to retry.`,
        );
    },
    onError: () => toast.error(`Couldn't sign in to ${provider.name}. Try again.`),
  });

  const logout = useMutation({
    mutationFn: () => nyte.host.logout({ provider: provider.id }),
    onSuccess: () => toast.success(`Signed out of ${provider.name}`),
    onError: () => toast.error(`Couldn't sign out of ${provider.name}. Try again.`),
  });

  const cancelLogin = (): void => {
    if (attempt === undefined) return;
    const id = attempt.attempt;
    setLoginAttemptCancelling(provider.id, id, true);
    void nyte.host.cancelLogin({ attempt: id }).catch(() => {
      // The attempt is still running; give the button back rather than a stuck state.
      setLoginAttemptCancelling(provider.id, id, false);
      toast.error(`Couldn't cancel the ${provider.name} sign-in. Try again.`);
    });
  };

  const busy = login.isPending || logout.isPending || setPreference.isPending;
  const browser = provider.signIn.find((method) => method.kind === "browser");
  const apiKey = provider.signIn.find((method) => method.kind === "api_key");
  const { connection } = provider;

  const status =
    attempt?.cancelling === true ? (
      <ConnectionStatus tone="warn">Cancelling</ConnectionStatus>
    ) : attempt?.deviceCode !== undefined ? (
      <ConnectionStatus tone="warn">Waiting for approval</ConnectionStatus>
    ) : attempt?.method === "browser" ? (
      <ConnectionStatus tone="warn">Waiting for the browser</ConnectionStatus>
    ) : undefined;

  const popular = popularProviders.find((entry) => entry.id === provider.id);
  const badge =
    connection.kind === "api_key"
      ? "API key"
      : connection.kind === "oauth"
        ? "Subscription"
        : popular?.recommended
          ? "Recommended"
          : undefined;

  const detail =
    connection.kind === "oauth"
      ? undefined
      : connection.kind === "api_key"
        ? connection.env === undefined
          ? undefined
          : `API key from ${connection.env}`
        : (popular?.description ??
          (browser !== undefined && apiKey !== undefined
            ? `Sign in with ${browser.subscription}, or add an API key`
            : apiKey !== undefined
              ? "Add an API key to connect"
              : browser !== undefined
                ? "Sign in to connect"
                : "Connects through the environment"));

  // A key from the environment is not ours to remove.
  const canSignOut =
    connection.kind === "oauth" || (connection.kind === "api_key" && connection.env === undefined);

  return (
    <ConnectionRow
      glyph={<Icon name={providerIcon(provider.id)} size={20} />}
      title={
        <span {...props(styles.providerTitle)}>
          {provider.name}
          {badge !== undefined && <span {...props(styles.providerBadge)}>{badge}</span>}
        </span>
      }
      detail={detail}
      status={status}
      actions={
        attempt !== undefined && attempt.method === "browser" ? (
          <Button disabled={attempt.cancelling} onClick={cancelLogin}>
            Cancel
          </Button>
        ) : connection.kind === "disconnected" ? (
          <>
            {browser !== undefined && (
              <Button
                variant="primary"
                icon="plus"
                disabled={busy}
                onClick={() => login.mutate({ kind: "browser" })}
              >
                {apiKey === undefined ? "Connect" : browser.label}
              </Button>
            )}
            {apiKey !== undefined && (
              <Button
                variant="primary"
                icon={browser === undefined ? "plus" : "key"}
                disabled={busy}
                aria-expanded={keyFormOpen}
                onClick={() => {
                  login.reset();
                  setKeyFormOpen((open) => !open);
                }}
              >
                {browser === undefined ? "Connect" : "Add API key"}
              </Button>
            )}
          </>
        ) : (
          <>
            {!provider.enabled && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  setPreference.mutate({ kind: "provider", provider: provider.id, enabled: true })
                }
              >
                Enable models
              </Button>
            )}
            {canSignOut && (
              <Button disabled={busy} onClick={() => logout.mutate()}>
                {logout.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            )}
          </>
        )
      }
      expansion={
        attempt?.deviceCode !== undefined ? (
          <DeviceCodePanel deviceCode={attempt.deviceCode} message={attempt.message} />
        ) : attempt?.browser !== undefined ? (
          <BrowserSignInPanel
            attempt={attempt.attempt}
            browser={attempt.browser}
            message={attempt.message}
          />
        ) : keyFormOpen && apiKey !== undefined ? (
          <ApiKeyForm
            label={apiKey.label}
            pending={login.isPending}
            onSubmit={(key) => login.mutate({ kind: "api_key", key })}
            onCancel={() => {
              cancelLogin();
              login.reset();
              setKeyFormOpen(false);
            }}
          />
        ) : attempt?.message !== undefined ? (
          <span role="status" {...props(styles.deviceCodeNote)}>
            {attempt.message}
          </span>
        ) : undefined
      }
    />
  );
}

function EnabledModelsSection({ catalog }: { catalog: DesktopCatalog }): ReactElement {
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
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>Enabled models</h2>
        <p {...props(settingsPatterns.sectionDescription)}>
          Disabled models cannot be used by chats or subagents.
        </p>
      </div>
      {enabled.length > 0 && (
        <InputGroup variant="quiet" xstyle={styles.search}>
          <Icon name="search" size={13} />
          <Input
            type="text"
            aria-label="Search models"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search models"
            value={query}
            onValueChange={setQuery}
          />
        </InputGroup>
      )}
      {enabled.length === 0 && (
        <div {...props(styles.quiet)}>Connect a provider to choose its models.</div>
      )}
      {enabled.length > 0 && groups.length === 0 && (
        <div {...props(styles.quiet)}>No models match.</div>
      )}
      {groups.map(({ provider, all, matching }) => {
        const active = all.filter((option) => !option.hidden).length;

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
            <span {...props(styles.groupTitle)}>{provider.name}</span>
            <span {...props(styles.groupMeta)}>
              <span>{active}</span> of <span>{all.length}</span> enabled
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
            xstyle={settingsPatterns.group}
          >
            <div {...props(styles.groupHeading)}>
              {needle === "" ? (
                <Collapsible.Trigger
                  aria-label={`${provider.name} models`}
                  xstyle={[styles.groupLabel, styles.groupTrigger, focus.ringInset]}
                >
                  {heading}
                </Collapsible.Trigger>
              ) : (
                <span {...props(styles.groupLabel)}>{heading}</span>
              )}
              <span {...props(styles.groupActions)}>
                <Button
                  disabled={active === all.length || setPreference.isPending}
                  onClick={() => setAll(false)}
                >
                  Enable all
                </Button>
                <Button
                  disabled={active === 0 || setPreference.isPending}
                  onClick={() => setAll(true)}
                >
                  Disable all
                </Button>
              </span>
            </div>
            <Collapsible.Panel xstyle={styles.groupPanel}>
              {matching.map((option) => (
                <Row key={option.key} size="lg" xstyle={styles.modelRow}>
                  <Row.Body>
                    <Row.Label>{option.name}</Row.Label>
                    <Row.Description title="Context window · price per million tokens, input / output">
                      {formatContextWindow(option.contextWindow)} · {formatPricing(option.cost)}
                    </Row.Description>
                  </Row.Body>
                  <Row.Actions>
                    <Switch
                      label={`Enable ${option.name}`}
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
                  </Row.Actions>
                </Row>
              ))}
            </Collapsible.Panel>
          </Collapsible.Root>
        );
      })}
    </section>
  );
}

export function ProvidersSettings(): ReactElement | null {
  const catalog = useCatalog();

  if (catalog.data === undefined) {
    if (!catalog.isError) return null;

    return (
      <div role="alert" title={catalog.error.message} {...props(styles.alert)}>
        Couldn&rsquo;t load providers. Try again.
      </div>
    );
  }

  const defaults = catalog.data.defaults;
  const connected = catalog.data.providers.filter(
    (provider) => provider.connection.kind !== "disconnected",
  );
  const disconnected = catalog.data.providers.filter(
    (provider) => provider.connection.kind === "disconnected",
  );
  const popular = popularProviders.flatMap((entry) => {
    const provider = disconnected.find((candidate) => candidate.id === entry.id);

    return provider === undefined ? [] : [provider];
  });
  const other = disconnected.filter(
    (provider) => !popularProviders.some((entry) => entry.id === provider.id),
  );

  return (
    <>
      <section {...props(styles.providers)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <p {...props(settingsPatterns.sectionDescription)}>Connect and manage model providers</p>
        </div>
        {[
          { title: "Connected providers", providers: connected },
          { title: "Popular providers", providers: popular },
          { title: "Other providers", providers: other },
        ].map((group) =>
          group.providers.length === 0 ? null : (
            <section
              key={group.title}
              aria-label={group.title}
              {...props(settingsPatterns.section)}
            >
              <div {...props(settingsPatterns.sectionHeader)}>
                <h3 {...props(settingsPatterns.sectionTitle)}>{group.title}</h3>
              </div>
              <div {...props(settingsPatterns.group, styles.providerList)}>
                {group.providers.map((provider) => (
                  <ProviderRow key={provider.id} provider={provider} />
                ))}
              </div>
            </section>
          ),
        )}
        {catalog.data.providers.length === 0 && (
          <p {...props(settingsPatterns.sectionDescription)}>No model providers available.</p>
        )}
      </section>
      {defaults !== undefined && <DefaultsSection catalog={catalog.data} defaults={defaults} />}
      <EnabledModelsSection catalog={catalog.data} />
    </>
  );
}
