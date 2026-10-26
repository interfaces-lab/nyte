import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Input } from "@nyte-ai/ui/input";
import { Switch } from "@nyte-ai/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { modelIcon, providerIcon } from "../conversation/model-picker-state.ts";
import { nyte } from "../nyte.ts";
import type { DesktopCatalog, DesktopModelOption, ProviderStatus } from "../catalog.ts";
import { useCatalog, useSetListing, useSetPreference } from "../queries.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { connection } from "../sdk.tsx";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionMenu, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { cancelLogin, startLogin, useLoginAttempt } from "./login-attempts.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { SettingsRow } from "../settings/rows.tsx";
import { BrowserSignInPanel, DeviceCodePanel } from "./sign-in-panels.tsx";
import { formatTokens } from "./usage-view.ts";

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

const outsideSignIn = new Map([
  ["claude-code", "Install Claude Code and run claude once to sign in"],
  ["acp", "Install an ACP agent such as Codex, Gemini CLI, or Cursor"],
]);

function ModelList({
  provider,
  models,
}: {
  provider: ProviderStatus;
  models: readonly DesktopModelOption[];
}): ReactElement {
  const setListing = useSetListing();
  const agents = provider.id === "acp";
  const hidden = models.filter((option) => option.listing === "hidden");

  return (
    <div {...props(styles.modelPanel)}>
      <div {...props(text.sm, styles.modelPanelHeader)}>
        <span>
          {agents
            ? "Pick an agent from the composer\u2019s model menu. Starred agents show first"
            : "Pick a model from the composer\u2019s model menu. Starred models show first"}
        </span>
        {models.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setListing.mutate({
                models: (hidden.length > 0
                  ? hidden
                  : models.filter((option) => option.listing !== "favorite")
                ).map((option) => ({ provider: option.provider, id: option.id })),
                listing: hidden.length > 0 ? "shown" : "hidden",
              })
            }
          >
            {hidden.length > 0 ? "Show All" : "Hide All"}
          </Button>
        )}
      </div>
      <ul aria-label={`${provider.name} models`} {...props(styles.modelList)}>
        {models.map((option) => {
          const model = [{ provider: option.provider, id: option.id }];
          const favorite = option.listing === "favorite";
          const shown = option.listing !== "hidden";

          return (
            <li key={option.key} {...props(styles.modelRow)}>
              <span {...props(text.base, styles.modelName, !shown && styles.modelHidden)}>
                {agents && <Icon name={modelIcon(option)} size={16} />}
                <span {...props(styles.modelNameText)}>{option.name}</span>
                {!agents && (
                  <span {...props(text.sm, styles.modelMeta)}>
                    {formatTokens(option.contextWindow)}
                  </span>
                )}
              </span>
              <Button
                iconOnly
                size="sm"
                aria-label={favorite ? `Unstar ${option.name}` : `Star ${option.name}`}
                aria-pressed={favorite}
                disabled={!shown}
                onClick={() =>
                  setListing.mutate({ models: model, listing: favorite ? "shown" : "favorite" })
                }
              >
                {favorite ? (
                  <Icon name="star" variant="filled" size={14} />
                ) : (
                  <Icon name="star" size={14} />
                )}
              </Button>
              <Switch
                label={`Show ${option.name}`}
                checked={shown}
                onCheckedChange={(show) =>
                  setListing.mutate({ models: model, listing: show ? "shown" : "hidden" })
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function modelSummary(provider: ProviderStatus, models: readonly DesktopModelOption[]): string {
  if (provider.id === "acp") {
    const names = models.map((option) => option.name);

    return names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 2).join(", ")}, and ${names.length - 2} more`;
  }

  const shown = models.filter((option) => option.listing !== "hidden").length;
  const favorites = models.filter((option) => option.listing === "favorite").length;

  const count =
    shown === models.length
      ? `${models.length} ${models.length === 1 ? "model" : "models"}`
      : `${shown} of ${models.length} models shown`;

  return favorites === 0 ? count : `${count} \u00b7 ${favorites} starred`;
}

export function NewChatsSection({
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

  const candidates = chosen !== undefined && !chosen.listed ? [chosen, ...listed] : listed;

  const modelOptions = candidates.map((option) => ({
    value: option.key,
    label: `${option.name} · ${providerNames.get(option.provider) ?? option.provider}`,
  }));

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
              : "New chats start on this model. Switch per chat from the composer"
          }
        >
          <Select
            items={modelOptions}
            value={chosen?.key ?? ""}
            disabled={candidates.length === 0}
            onValueChange={(key) => {
              const option = candidates.find((candidate) => candidate.key === key);

              if (option === undefined || setPreference.isPending) return;
              setPreference.mutate({ provider: option.provider, id: option.id });
            }}
          >
            <SelectTrigger aria-label="Default model" width="wide">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </div>
    </section>
  );
}

function ApiKeyForm({
  label,
  pending,
  field,
  onSubmit,
  onCancel,
}: {
  label: string;
  pending: boolean;
  field: RefObject<HTMLInputElement | null>;
  onSubmit: (key: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [key, setKey] = useState("");

  useMountEffect(() => {
    field.current?.focus();
  });

  return (
    <form
      {...props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && key.trim() !== "") onSubmit(key.trim());
      }}
    >
      <div {...props(styles.keyRow)}>
        <Input
          ref={field}
          variant="code"
          type="password"
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          placeholder={`Paste your ${label}`}
          value={key}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setKey}
        />
        <Button
          type="submit"
          variant="solid"
          tone="primary"
          loading={pending}
          disabled={key.trim() === ""}
        >
          Save API Key
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <span {...props(text.sm, styles.keyHint)}>
        {nyte.clientSurface === "web"
          ? "Stored on the machine running the server"
          : "Stored on this Mac"}
      </span>
    </form>
  );
}

function ProviderRow({
  provider,
  models,
}: {
  provider: ProviderStatus;
  models: readonly DesktopModelOption[];
}): ReactElement {
  const setPreference = useSetPreference();
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const keyField = useRef<HTMLInputElement>(null);
  const running = useLoginAttempt(provider.id);
  const disconnected = provider.credential === "missing";
  const unknown = provider.credential === "unknown";
  const attempt = disconnected ? running : undefined;

  const login = useMutation({
    mutationFn: (
      method: { readonly kind: "browser" } | { readonly kind: "api_key"; readonly key: string },
    ) => startLogin(provider.id, method),
    onSuccess: (outcome) => {
      if (outcome.kind === "cancelled") return;
      setKeyFormOpen(false);
      toast.add({ type: "success", title: `Connected to ${provider.name}` });
    },
    onError: (error) =>
      toast.add({
        type: "error",
        title: `Couldn't sign in to ${provider.name}. Try again.`,
        description: error.message,
      }),
  });

  const logout = useMutation({
    mutationFn: () => connection().models.logout(provider.id),
    onSuccess: () => toast.add({ type: "success", title: `Signed out of ${provider.name}` }),
    onError: () =>
      toast.add({ type: "error", title: `Couldn't sign out of ${provider.name}. Try again.` }),
  });

  const recheck = useMutation({
    mutationFn: () => connection().models.refresh(provider.id),
    onError: () =>
      toast.add({ type: "error", title: `Couldn't check ${provider.name}. Try again.` }),
  });

  const stopLogin = (): void => {
    if (attempt !== undefined) cancelLogin(provider.id);
  };

  const busy = login.isPending || logout.isPending || setPreference.isPending;
  const browser = provider.methods.find((method) => method.kind === "oauth");
  const apiKey = provider.methods.find((method) => method.kind === "key");

  const waiting =
    attempt?.cancelling === true
      ? "Cancelling"
      : attempt?.deviceCode !== undefined
        ? "Waiting for approval"
        : attempt?.method === "browser"
          ? "Waiting for the browser"
          : undefined;

  const popular = popularProviders.find((entry) => entry.id === provider.id);

  const badge =
    provider.credential === "failed"
      ? "Credential failed"
      : disconnected && popular?.recommended === true
        ? "Recommended"
        : undefined;

  const detail =
    waiting ??
    (!disconnected
      ? unknown || models.length === 0
        ? undefined
        : modelSummary(provider, models)
      : (popular?.description ??
        (browser !== undefined && apiKey !== undefined
          ? "Sign in, or add an API key"
          : apiKey !== undefined
            ? "Add an API key to connect"
            : browser !== undefined
              ? "Sign in to connect"
              : (outsideSignIn.get(provider.id) ?? "Connects through the environment"))));

  const signsInHere = browser !== undefined || apiKey !== undefined;
  const canSignOut = !disconnected && !unknown && signsInHere;
  const browsable = !disconnected && !unknown && models.length > 0;

  const status = canSignOut ? (
    <ConnectionMenu
      label={provider.name}
      tone="on"
      status="Connected"
      loading={logout.isPending}
      disabled={login.isPending || setPreference.isPending}
    >
      <MenuItem variant="danger" onClick={() => logout.mutate()}>
        Disconnect Provider
      </MenuItem>
    </ConnectionMenu>
  ) : (
    <ConnectionStatus tone="on">Connected</ConnectionStatus>
  );

  return (
    <ConnectionRow
      glyph={<Icon name={providerIcon(provider.id)} size={20} />}
      title={
        <span {...props(styles.providerTitle)}>
          {provider.name}
          {badge !== undefined && <span {...props(text.sm, styles.providerBadge)}>{badge}</span>}
        </span>
      }
      detail={detail}
      control={
        unknown ? (
          <ConnectionStatus tone="off">Not checked</ConnectionStatus>
        ) : attempt !== undefined && attempt.method === "browser" ? (
          <Button variant="outline" loading={attempt.cancelling} onClick={stopLogin}>
            Cancel
          </Button>
        ) : disconnected ? (
          !signsInHere ? (
            <Button variant="outline" loading={recheck.isPending} onClick={() => recheck.mutate()}>
              Check Again
              <span {...props(srOnly)}> {provider.name}</span>
            </Button>
          ) : browser !== undefined && apiKey !== undefined ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="outline" loading={login.isPending} disabled={busy}>
                    Connect Provider
                    <span {...props(srOnly)}> {provider.name}</span>
                    <Icon name="chevron-down" size={12} />
                  </Button>
                }
              />
              <MenuContent align="end" finalFocus={() => keyField.current ?? true}>
                <MenuItem onClick={() => login.mutate({ kind: "browser" })}>Sign In</MenuItem>
                <MenuItem
                  icon="key"
                  onClick={() => {
                    login.reset();
                    setKeyFormOpen(true);
                  }}
                >
                  Add API Key…
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <Button
              variant="outline"
              loading={login.isPending}
              disabled={logout.isPending || setPreference.isPending}
              aria-expanded={apiKey !== undefined ? keyFormOpen : undefined}
              onClick={() => {
                if (browser !== undefined) login.mutate({ kind: "browser" });
                else {
                  login.reset();
                  setKeyFormOpen((open) => !open);
                }
              }}
            >
              Connect Provider
              <span {...props(srOnly)}> {provider.name}</span>
            </Button>
          )
        ) : (
          <span {...props(styles.controls)}>
            {status}
            {browsable && (
              <Button
                variant="outline"
                aria-expanded={modelsOpen}
                onClick={() => setModelsOpen((open) => !open)}
              >
                {provider.id === "acp" ? "Agents" : "Models"}
                <span {...props(srOnly)}> for {provider.name}</span>
                <Icon name={modelsOpen ? "chevron-down" : "chevron-right"} size={12} />
              </Button>
            )}
          </span>
        )
      }
      expansion={
        attempt?.deviceCode !== undefined ? (
          <DeviceCodePanel deviceCode={attempt.deviceCode} />
        ) : attempt?.browser !== undefined ? (
          <BrowserSignInPanel login={provider.id} browser={attempt.browser} />
        ) : keyFormOpen && apiKey !== undefined ? (
          <ApiKeyForm
            label="API key"
            pending={login.isPending}
            field={keyField}
            onSubmit={(key) => login.mutate({ kind: "api_key", key })}
            onCancel={() => {
              stopLogin();
              login.reset();
              setKeyFormOpen(false);
            }}
          />
        ) : modelsOpen && browsable ? (
          <ModelList provider={provider} models={models} />
        ) : undefined
      }
    />
  );
}

export function ProvidersSettings(): ReactElement | null {
  const catalog = useCatalog();

  if (catalog.data === undefined) {
    if (!catalog.isError) return null;

    return (
      <div
        role="alert"
        title={catalog.error.message}
        {...props(text.sm, intent.danger, styles.alert)}
      >
        Couldn&rsquo;t load providers. Try again.
      </div>
    );
  }

  const connected = catalog.data.providers.filter(
    (provider) => provider.credential !== "missing" && provider.credential !== "unknown",
  );

  const unknown = catalog.data.providers.filter((provider) => provider.credential === "unknown");

  const disconnected = catalog.data.providers.filter(
    (provider) => provider.credential === "missing",
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
        {[
          { title: "Connected providers", providers: connected },
          { title: "Providers", providers: unknown },
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
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    models={catalog.data.models.filter((option) => option.provider === provider.id)}
                  />
                ))}
              </div>
            </section>
          ),
        )}
        {catalog.data.providers.length === 0 && (
          <p {...props(settingsPatterns.sectionDescription)}>No model providers available.</p>
        )}
      </section>
    </>
  );
}
