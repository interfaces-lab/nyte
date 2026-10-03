/**
 * Environment operations: what the machine serving the SDK owns beside it.
 * Its provider credentials and model preferences, its usage history, and its
 * GitHub CLI login. The SDK never implements these. A host that owns an
 * environment passes one to the server, the calls share the SDK's call route
 * and envelopes, and `/v1/info` reports `environment: true`.
 *
 * No call waits on a person. `environment.login` starts an attempt the client
 * polls with `environment.loginAttempt`. `environment.github.signIn` answers
 * once the CLI has a one-time code, and `environment.github.state` reports
 * `signing_in` until the code is entered or the sign-in ends.
 * `environment.github.createPullRequest` opens one for the served folder's
 * checked-out branch, which the client pushes first.
 */
import type { ModelThinkingLevel, Usage as UsageType } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  ModelInfo,
  NonEmptyString,
  SessionId,
  ThinkingLevel,
  Usage,
  list,
  strict,
  typed,
} from "./schemas.ts";
import type { SessionId as SessionIdType } from "./sdk.ts";
import type { ModelInfo as ModelInfoType } from "./workspace.ts";

// ---------------------------------------------------------------------------
// Providers and models
// ---------------------------------------------------------------------------

export type SignInMethod =
  | { readonly kind: "browser"; readonly label: string; readonly subscription: string }
  | { readonly kind: "api_key"; readonly label: string };

export interface ProviderStatus {
  readonly id: string;
  readonly name: string;
  /** Off keeps the provider's models out of the picker and out of the default. */
  readonly enabled: boolean;
  /** `env` names the variable when the key came from the environment rather than the store. */
  readonly connection:
    | { readonly kind: "disconnected" }
    | { readonly kind: "server" }
    | { readonly kind: "oauth" }
    | { readonly kind: "api_key"; readonly env?: string };
  readonly signIn: readonly SignInMethod[];
}

export interface CatalogModel extends ModelInfoType {
  /** `provider/id`. */
  readonly key: string;
  readonly fastMode:
    | { readonly kind: "unavailable" }
    | { readonly kind: "available"; readonly settingId: string };
  readonly hidden: boolean;
  /** In the picker: the provider is on and connected, and the model is not hidden. */
  readonly listed: boolean;
}

/**
 * Providers, models, and what a new chat starts with, in one read. An
 * environment answers `local`; `server` marks a catalog a client assembled
 * from another host's `provider.models` operations.
 */
export interface ProviderCatalog {
  readonly source: "local" | "server";
  readonly providers: readonly ProviderStatus[];
  readonly models: readonly CatalogModel[];
  /** Absent until the catalog has a model. */
  readonly defaults?: {
    readonly model: { readonly provider: string; readonly id: string };
    readonly thinkingLevel: ModelThinkingLevel;
    /** Applies when the chosen model offers fast mode. */
    readonly fast: boolean;
  };
}

export type PreferenceChange =
  | { readonly kind: "provider"; readonly provider: string; readonly enabled: boolean }
  | {
      readonly kind: "models";
      readonly provider: string;
      readonly ids: readonly string[];
      readonly hidden: boolean;
    }
  | {
      readonly kind: "defaults";
      readonly model?: { readonly provider: string; readonly id: string };
      readonly thinkingLevel?: ModelThinkingLevel;
      readonly fast?: boolean;
    };

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** Days in the serving machine's time zone. */
export interface UsageWindow {
  /** `YYYY-MM-DD`, inclusive, or `null` for every retained day. */
  readonly sinceDay: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  readonly untilDay: string;
}

/** Recorded tokens and API-equivalent cost. `reasoning` is part of `output`. */
export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  readonly tokens: number;
  readonly cost: number;
  /** Usage-bearing commits, including compaction and tools, not user turns. */
  readonly turns: number;
}

export type UsageSubject =
  | { readonly kind: "model"; readonly provider: string; readonly model: string }
  | { readonly kind: "tool" }
  | { readonly kind: "compaction" };

/** One day, workspace, chat, and subject. Totals live only on entries. */
export interface UsageEntry {
  readonly day: string;
  readonly workspacePath: string | null;
  readonly sessionId: SessionIdType;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
}

export interface UsageSession {
  readonly sessionId: SessionIdType;
  readonly name?: string;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
}

/** How one store's read went. A failed store is a row, not a failed report. */
export interface UsageSource {
  readonly workspacePath: string | null;
  readonly status: "ok" | "failed";
  readonly sessions: number;
  readonly message: string | null;
}

export interface UsageReport {
  readonly readAt: number;
  /** The resolved window. An all-time read starts at the earliest retained day. */
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly entries: readonly UsageEntry[];
  readonly sessions: readonly UsageSession[];
  readonly sources: readonly UsageSource[];
  /** The equal-length window just before this one, when history reaches that far. */
  readonly previous?: { readonly cost: number; readonly tokens: number };
  readonly earliestDay?: string;
}

export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly turns: number;
  readonly usage: UsageType;
}

export interface UsageSummary {
  readonly models: readonly ModelUsage[];
  readonly compaction: UsageType;
  readonly tools: UsageType;
  readonly total: UsageType;
}

/** Another tool's own history on the serving machine, kept apart from Nyte's entries. */
export type LocalHistoryUsage =
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly summary: UsageSummary;
      readonly unpricedRecords: number;
      readonly malformedRecords: number;
      readonly unreadableFiles: number;
    };

export interface UsageSnapshot extends UsageReport {
  /** The whole Nyte read failed, apart from any single failed store. */
  readonly nyteError: string | null;
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}

export interface AccountLimitWindow {
  readonly id: string;
  readonly usedPercent: number;
  /** Epoch milliseconds. */
  readonly resetsAt?: number;
  readonly windowMinutes?: number;
}

export interface AccountLimits {
  readonly providerId: string;
  readonly plan?: string;
  readonly windows: readonly AccountLimitWindow[];
  /** Epoch milliseconds when the provider reported this. */
  readonly observedAt: number;
}

/** A subscription's windows as its provider reports them, separate from recorded usage. */
export type AccountUsage = { readonly provider: "anthropic" | "openai-codex" } & (
  | { readonly kind: "ready"; readonly limits: AccountLimits }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed"; readonly message: string }
);

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export type LoginMethod =
  | { readonly kind: "browser" }
  | { readonly kind: "api_key"; readonly key: string };

/** A code the user enters at `verificationUri`. It stays until the attempt ends. */
export interface DeviceCode {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds?: number;
  readonly instructions?: string;
}

/** The page a browser sign-in finishes on. The client opens it; the serving machine never does. */
export interface BrowserSignIn {
  readonly url: string;
  readonly instructions?: string;
  /** `environment.answerLogin` can finish the flow with a pasted code or redirect address. */
  readonly acceptsCode: boolean;
}

/** A saved credential is `connected` even when the model list could not be refreshed after it. */
export type LoginOutcome =
  | { readonly kind: "connected"; readonly catalogRefreshed: boolean }
  | { readonly kind: "cancelled" };

export type LoginAttempt =
  /** Never started here, or ended long enough ago that the environment let it go. */
  | { readonly kind: "unknown" }
  | {
      readonly kind: "running";
      readonly deviceCode?: DeviceCode;
      readonly browser?: BrowserSignIn;
      /** The flow's latest word. It never replaces a device code. */
      readonly message?: string;
    }
  | { readonly kind: "settled"; readonly outcome: LoginOutcome }
  /** No message: a provider's error can carry upstream text. */
  | { readonly kind: "failed" };

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
  readonly remoteName: string;
  /** The canonical public URL. Remote credentials and raw remote URLs never cross. */
  readonly url: string;
}

export interface GitHubAccount {
  readonly login: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly draft: boolean;
  readonly headRefName: string;
  readonly baseRefName: string;
}

export type GitHubPullRequestContext =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "error"; readonly message: string };

export interface GitHubPullRequestInput {
  readonly title: string;
  readonly body?: string;
  readonly draft?: boolean;
}

/**
 * Every state `gh` can leave a pull request request in. `exists` carries the
 * pull request already open for this branch; nothing is created then.
 */
export type GitHubPullRequestOutcome =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "exists"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "cli_missing" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "no_remote" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The serving machine's GitHub CLI login, and the repository of the workspace
 * it serves. GitHub is optional enrichment: no variant changes whether version
 * control works.
 */
export type GitHubProviderState =
  | { readonly kind: "cli_missing"; readonly repository?: GitHubRepository }
  | { readonly kind: "signed_out"; readonly repository?: GitHubRepository }
  | {
      readonly kind: "signing_in";
      readonly repository?: GitHubRepository;
      readonly deviceCode: DeviceCode;
    }
  | {
      readonly kind: "ready";
      readonly repository?: GitHubRepository;
      readonly account: GitHubAccount;
      readonly pullRequest: GitHubPullRequestContext;
    }
  | {
      readonly kind: "error";
      readonly repository?: GitHubRepository;
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// Schemas: inputs strict, outputs open, each pinned to its type
// ---------------------------------------------------------------------------

const StringOrNull = Type.Union([Type.String(), Type.Null()]);

const Day = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

const SignInMethodSchema = typed<SignInMethod>()(
  Type.Union([
    Type.Object({
      kind: Type.Literal("browser"),
      label: Type.String(),
      subscription: Type.String(),
    }),
    Type.Object({ kind: Type.Literal("api_key"), label: Type.String() }),
  ]),
);

const ProviderStatusSchema = typed<ProviderStatus>()(
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    enabled: Type.Boolean(),
    connection: Type.Union([
      Type.Object({ kind: Type.Literal("disconnected") }),
      Type.Object({ kind: Type.Literal("server") }),
      Type.Object({ kind: Type.Literal("oauth") }),
      Type.Object({ kind: Type.Literal("api_key"), env: Type.Optional(Type.String()) }),
    ]),
    signIn: Type.Array(SignInMethodSchema),
  }),
);

const CatalogModelSchema = typed<CatalogModel>()(
  Type.Intersect([
    ModelInfo,
    Type.Object({
      key: Type.String(),
      fastMode: Type.Union([
        Type.Object({ kind: Type.Literal("unavailable") }),
        Type.Object({ kind: Type.Literal("available"), settingId: Type.String() }),
      ]),
      hidden: Type.Boolean(),
      listed: Type.Boolean(),
    }),
  ]),
);

const ProviderCatalogSchema = typed<ProviderCatalog>()(
  Type.Object({
    source: Type.Enum(["local", "server"]),
    providers: Type.Array(ProviderStatusSchema),
    models: Type.Array(CatalogModelSchema),
    defaults: Type.Optional(
      Type.Object({
        model: Type.Object({ provider: Type.String(), id: Type.String() }),
        thinkingLevel: ThinkingLevel,
        fast: Type.Boolean(),
      }),
    ),
  }),
);

const PreferenceChangeSchema = typed<PreferenceChange>()(
  Type.Union([
    strict({ kind: Type.Literal("provider"), provider: NonEmptyString, enabled: Type.Boolean() }),
    strict({
      kind: Type.Literal("models"),
      provider: NonEmptyString,
      ids: Type.Array(Type.String()),
      hidden: Type.Boolean(),
    }),
    strict({
      kind: Type.Literal("defaults"),
      model: Type.Optional(strict({ provider: NonEmptyString, id: NonEmptyString })),
      thinkingLevel: Type.Optional(ThinkingLevel),
      fast: Type.Optional(Type.Boolean()),
    }),
  ]),
);

const UsageWindowSchema = typed<UsageWindow>()(
  strict({ sinceDay: Type.Union([Day, Type.Null()]), untilDay: Day }),
);

const UsageTotalsSchema = typed<UsageTotals>()(
  Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    reasoning: Type.Number(),
    tokens: Type.Number(),
    cost: Type.Number(),
    turns: Type.Number(),
  }),
);

const UsageSubjectSchema = typed<UsageSubject>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("model"), provider: Type.String(), model: Type.String() }),
    Type.Object({ kind: Type.Literal("tool") }),
    Type.Object({ kind: Type.Literal("compaction") }),
  ]),
);

const UsageEntrySchema = typed<UsageEntry>()(
  Type.Object({
    day: Type.String(),
    workspacePath: StringOrNull,
    sessionId: SessionId,
    subject: UsageSubjectSchema,
    totals: UsageTotalsSchema,
  }),
);

const UsageSessionSchema = typed<UsageSession>()(
  Type.Object({
    sessionId: SessionId,
    name: Type.Optional(Type.String()),
    workspacePath: StringOrNull,
    lastActivityAt: Type.Number(),
  }),
);

const UsageSourceSchema = typed<UsageSource>()(
  Type.Object({
    workspacePath: StringOrNull,
    status: Type.Enum(["ok", "failed"]),
    sessions: Type.Number(),
    message: StringOrNull,
  }),
);

const LocalHistoryUsageSchema = typed<LocalHistoryUsage>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("missing") }),
    Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
    Type.Object({
      kind: Type.Literal("ready"),
      summary: Type.Object({
        models: Type.Array(
          Type.Object({
            provider: Type.String(),
            model: Type.String(),
            turns: Type.Number(),
            usage: Usage,
          }),
        ),
        compaction: Usage,
        tools: Usage,
        total: Usage,
      }),
      unpricedRecords: Type.Number(),
      malformedRecords: Type.Number(),
      unreadableFiles: Type.Number(),
    }),
  ]),
);

const UsageSnapshotSchema = typed<UsageSnapshot>()(
  Type.Object({
    readAt: Type.Number(),
    sinceDay: Type.String(),
    untilDay: Type.String(),
    entries: Type.Array(UsageEntrySchema),
    sessions: Type.Array(UsageSessionSchema),
    sources: Type.Array(UsageSourceSchema),
    previous: Type.Optional(Type.Object({ cost: Type.Number(), tokens: Type.Number() })),
    earliestDay: Type.Optional(Type.String()),
    nyteError: StringOrNull,
    claudeCode: LocalHistoryUsageSchema,
    codex: LocalHistoryUsageSchema,
  }),
);

const AccountProvider = Type.Enum(["anthropic", "openai-codex"]);

const AccountUsageSchema = typed<AccountUsage>()(
  Type.Union([
    Type.Object({
      provider: AccountProvider,
      kind: Type.Literal("ready"),
      limits: Type.Object({
        providerId: Type.String(),
        plan: Type.Optional(Type.String()),
        windows: Type.Array(
          Type.Object({
            id: Type.String(),
            usedPercent: Type.Number(),
            resetsAt: Type.Optional(Type.Number()),
            windowMinutes: Type.Optional(Type.Number()),
          }),
        ),
        observedAt: Type.Number(),
      }),
    }),
    Type.Object({ provider: AccountProvider, kind: Type.Literal("unavailable") }),
    Type.Object({
      provider: AccountProvider,
      kind: Type.Literal("failed"),
      message: Type.String(),
    }),
  ]),
);

const LoginMethodSchema = typed<LoginMethod>()(
  Type.Union([
    strict({ kind: Type.Literal("browser") }),
    strict({ kind: Type.Literal("api_key"), key: Type.String({ pattern: "\\S" }) }),
  ]),
);

const DeviceCodeSchema = typed<DeviceCode>()(
  Type.Object({
    userCode: Type.String(),
    verificationUri: Type.String(),
    expiresInSeconds: Type.Optional(Type.Number()),
    instructions: Type.Optional(Type.String()),
  }),
);

const LoginAttemptSchema = typed<LoginAttempt>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("unknown") }),
    Type.Object({
      kind: Type.Literal("running"),
      deviceCode: Type.Optional(DeviceCodeSchema),
      browser: Type.Optional(
        Type.Object({
          url: Type.String(),
          instructions: Type.Optional(Type.String()),
          acceptsCode: Type.Boolean(),
        }),
      ),
      message: Type.Optional(Type.String()),
    }),
    Type.Object({
      kind: Type.Literal("settled"),
      outcome: Type.Union([
        Type.Object({ kind: Type.Literal("connected"), catalogRefreshed: Type.Boolean() }),
        Type.Object({ kind: Type.Literal("cancelled") }),
      ]),
    }),
    Type.Object({ kind: Type.Literal("failed") }),
  ]),
);

/** Only GitHub's own pages reach a client, which opens them without asking. */
const GitHubUrl = Type.String({ pattern: "^https://github\\.com/" });

const repository = Type.Optional(
  Type.Object({
    owner: Type.String(),
    name: Type.String(),
    remoteName: Type.String(),
    url: GitHubUrl,
  }),
);

const GitHubPullRequestSchema = typed<GitHubPullRequest>()(
  Type.Object({
    number: Type.Number(),
    title: Type.String(),
    url: GitHubUrl,
    state: Type.Enum(["OPEN", "CLOSED", "MERGED"]),
    draft: Type.Boolean(),
    headRefName: Type.String(),
    baseRefName: Type.String(),
  }),
);

const GitHubProviderStateSchema = typed<GitHubProviderState>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("cli_missing"), repository }),
    Type.Object({ kind: Type.Literal("signed_out"), repository }),
    Type.Object({ kind: Type.Literal("signing_in"), repository, deviceCode: DeviceCodeSchema }),
    Type.Object({
      kind: Type.Literal("ready"),
      repository,
      account: Type.Object({
        login: Type.String(),
        name: Type.Optional(Type.String()),
        avatarUrl: Type.Optional(
          Type.String({ pattern: "^https://avatars\\.githubusercontent\\.com/" }),
        ),
      }),
      pullRequest: Type.Union([
        Type.Object({ kind: Type.Literal("none") }),
        Type.Object({ kind: Type.Literal("ready"), pullRequest: GitHubPullRequestSchema }),
        Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
      ]),
    }),
    Type.Object({ kind: Type.Literal("error"), repository, message: Type.String() }),
  ]),
);

const GitHubPullRequestInputSchema = typed<GitHubPullRequestInput>()(
  strict({
    title: Type.String({ minLength: 1, maxLength: 256, pattern: "\\S" }),
    body: Type.Optional(Type.String({ maxLength: 65_536 })),
    draft: Type.Optional(Type.Boolean()),
  }),
);

const GitHubPullRequestOutcomeSchema = typed<GitHubPullRequestOutcome>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("created"), url: GitHubUrl }),
    Type.Object({ kind: Type.Literal("exists"), pullRequest: GitHubPullRequestSchema }),
    Type.Object({ kind: Type.Literal("cli_missing") }),
    Type.Object({ kind: Type.Literal("signed_out") }),
    Type.Object({ kind: Type.Literal("no_remote") }),
    Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
  ]),
);

// ---------------------------------------------------------------------------
// The operation table
// ---------------------------------------------------------------------------

const none = Type.Undefined();

/** A client-chosen correlation ID, bounded so it cannot carry a payload. */
const attempt = Type.String({ minLength: 1, maxLength: 64 });

export const ENVIRONMENT_OPERATIONS = Object.freeze({
  "environment.catalog": { input: none, output: ProviderCatalogSchema },
  /** Apply one change and answer with the catalog as it now stands. */
  "environment.setPreference": { input: PreferenceChangeSchema, output: ProviderCatalogSchema },
  "environment.usage": { input: UsageWindowSchema, output: UsageSnapshotSchema },
  /** The one usage read that leaves the serving machine: each provider reports its own windows. */
  "environment.accountLimits": { input: none, output: list(AccountUsageSchema) },
  /**
   * Start a sign-in and answer with its state at once. A new attempt for the
   * same provider supersedes the running one. A known attempt ID answers that
   * attempt instead of starting another.
   */
  "environment.login": {
    input: strict({ provider: NonEmptyString, method: LoginMethodSchema, attempt }),
    output: LoginAttemptSchema,
  },
  "environment.loginAttempt": { input: strict({ attempt }), output: LoginAttemptSchema },
  "environment.answerLogin": {
    input: strict({ attempt, code: Type.String({ pattern: "\\S" }) }),
    output: Type.Void(),
  },
  /** An attempt that already ended is a no-op. */
  "environment.cancelLogin": { input: strict({ attempt }), output: Type.Void() },
  "environment.logout": { input: strict({ provider: NonEmptyString }), output: Type.Void() },
  "environment.github.state": { input: none, output: GitHubProviderStateSchema },
  /** Answers `signing_in` once the CLI has a one-time code, or the state it ended in. */
  "environment.github.signIn": { input: none, output: GitHubProviderStateSchema },
  /** Ends a sign-in still waiting for its code; otherwise removes the CLI login. */
  "environment.github.signOut": { input: none, output: GitHubProviderStateSchema },
  /** Opens one for the served folder's checked-out branch; the branch is pushed first. */
  "environment.github.createPullRequest": {
    input: GitHubPullRequestInputSchema,
    output: GitHubPullRequestOutcomeSchema,
  },
});

export type EnvironmentOperation = keyof typeof ENVIRONMENT_OPERATIONS;

export type EnvironmentInput<V extends EnvironmentOperation> = Static<
  (typeof ENVIRONMENT_OPERATIONS)[V]["input"]
>;

export type EnvironmentOutput<V extends EnvironmentOperation> = Static<
  (typeof ENVIRONMENT_OPERATIONS)[V]["output"]
>;

/**
 * What a host implements to answer environment operations: one handler per
 * operation, keyed by its wire name. The server dispatches by that name, so a
 * missing handler fails the build, not a request.
 */
export type Environment = {
  readonly [V in EnvironmentOperation]: (
    input: EnvironmentInput<V>,
  ) => Promise<EnvironmentOutput<V>>;
};

/** Own keys only: an inherited name such as `constructor` is not an operation. */
export function isEnvironmentOperation(name: string): name is EnvironmentOperation {
  return Object.hasOwn(ENVIRONMENT_OPERATIONS, name);
}
