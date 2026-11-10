import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Input } from "@nyte-ai/ui/input";
import { Switch } from "@nyte-ai/ui/switch";
import { AGENT_PROVIDERS, modelIcon, providerIcon } from "../chat/composer/model-picker-state.ts";
import { nyte } from "../contract/nyte.ts";
import type { DesktopModelOption, ProviderStatus } from "../data/catalog.ts";
import {
  useCatalog,
  useCatalogGeneration,
  useSetListing,
  useSetPreference,
} from "../data/catalog.ts";
import { keys } from "../data/query-client.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { connection } from "../data/connection.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionMenu, ConnectionRow, ConnectionStatus } from "../components/connection-list.tsx";
import { cancelLogin, startLogin, useLoginAttempt } from "../account/login-attempts.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { BrowserSignInPanel, DeviceCodePanel } from "../account/sign-in-panels.tsx";
import { formatTokens } from "../lib/format.ts";

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
  const agents = AGENT_PROVIDERS.has(provider.id);
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
                {agents && <Icon name={modelIcon(option)} size="md" />}
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
                  <Icon name="star" variant="filled" size="sm" />
                ) : (
                  <Icon name="star" size="sm" />
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
  if (AGENT_PROVIDERS.has(provider.id)) {
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

function AccountNameForm({
  provider,
  current,
  pending,
  field,
  onSubmit,
  onCancel,
}: {
  provider: string;
  current: string;
  pending: boolean;
  field: RefObject<HTMLInputElement | null>;
  onSubmit: (label: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [name, setName] = useState(current);
  const label = name.trim();

  useMountEffect(() => {
    field.current?.focus();
    field.current?.select();
  });

  return (
    <form
      {...props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && label !== "" && label !== current) onSubmit(label);
      }}
    >
      <div {...props(styles.keyRow)}>
        <Input
          ref={field}
          aria-label={`${provider} account name`}
          autoComplete="off"
          spellCheck={false}
          placeholder="Account name"
          value={name}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setName}
        />
        <Button
          type="submit"
          variant="solid"
          tone="primary"
          loading={pending}
          disabled={label === "" || label === current}
        >
          Save
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
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
  const client = useQueryClient();
  const generation = useCatalogGeneration();
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const keyField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
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

  const refreshAccounts = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["model-accounts", provider.id] }),
      client.invalidateQueries({ queryKey: ["account-limits"] }),
    ]);

  const rename = useMutation({
    mutationFn: (input: { readonly account: string; readonly label: string }) =>
      connection().models.renameAccount(provider.id, input.account, input.label),
    onSuccess: (_result, input) => {
      setRenameOpen(false);
      toast.add({ type: "success", title: `Renamed account to ${input.label}` });

      return refreshAccounts();
    },
    onError: (error) =>
      toast.add({
        type: "error",
        title: "Couldn't rename the account. Try again.",
        description: error.message,
      }),
  });

  const switchAccount = useMutation({
    mutationFn: (account: string) => connection().models.selectAccount(provider.id, account),
    onSuccess: () => refreshAccounts(),
    onError: () =>
      toast.add({ type: "error", title: `Couldn't switch ${provider.name} accounts. Try again.` }),
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

  const accounts =
    useQuery({
      queryKey: keys.modelAccounts(provider.id, generation),
      queryFn: () => connection().models.accounts(provider.id),
      enabled: canSignOut,
    }).data ?? [];

  const active = accounts.find((account) => account.active);

  const status = canSignOut ? (
    <ConnectionMenu
      label={provider.name}
      tone="on"
      status="Connected"
      loading={logout.isPending || switchAccount.isPending}
      disabled={login.isPending || setPreference.isPending}
      finalFocus={() => nameField.current ?? true}
    >
      {accounts.length > 1 ? (
        <MenuGroup>
          <MenuGroupLabel>Accounts</MenuGroupLabel>
          <MenuRadioGroup value={active?.id ?? null}>
            {accounts.map((account) => (
              <MenuRadioItem
                key={account.id}
                value={account.id}
                onClick={() => {
                  if (account.active) return;
                  setRenameOpen(false);
                  switchAccount.mutate(account.id);
                }}
              >
                {account.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      ) : (
        active !== undefined && (
          <MenuGroup>
            <MenuGroupLabel>{active.label}</MenuGroupLabel>
          </MenuGroup>
        )
      )}
      {active !== undefined && (
        <>
          <MenuItem
            icon="pencil"
            onClick={() => {
              rename.reset();
              setModelsOpen(false);
              setRenameOpen(true);
            }}
          >
            Rename Account…
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuItem variant="danger" onClick={() => logout.mutate()}>
        Disconnect Provider
      </MenuItem>
    </ConnectionMenu>
  ) : (
    <ConnectionStatus tone="on">Connected</ConnectionStatus>
  );

  return (
    <ConnectionRow
      glyph={<Icon name={providerIcon(provider.id)} size="lg" />}
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
                    <Icon name="chevron-down" size="xs" />
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
                onClick={() => {
                  setRenameOpen(false);
                  setModelsOpen((open) => !open);
                }}
              >
                {AGENT_PROVIDERS.has(provider.id) ? "Agents" : "Models"}
                <span {...props(srOnly)}> for {provider.name}</span>
                <Icon name={modelsOpen ? "chevron-down" : "chevron-right"} size="xs" />
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
        ) : renameOpen && canSignOut && active !== undefined ? (
          <AccountNameForm
            provider={provider.name}
            current={active.label}
            pending={rename.isPending}
            field={nameField}
            onSubmit={(label) => rename.mutate({ account: active.id, label })}
            onCancel={() => setRenameOpen(false)}
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
