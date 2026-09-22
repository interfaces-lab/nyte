/**
 * Fetch-only Copilot OAuth from Pi 71dca871bc80b6bc97be37f0ca3189399d651fff.
 * Hosts own interaction and storage; login and refresh publish only complete credentials.
 */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  GITHUB_COPILOT_API_VERSION,
  GITHUB_COPILOT_DEFAULT_ORIGIN,
  GITHUB_COPILOT_HEADERS,
} from "../../api/github-copilot-headers.ts";
import { parseGitHubCopilotCatalog } from "../../providers/github-copilot-catalog.ts";
import type { FetchFunction } from "../../types.ts";
import { raceWithAbortSignal } from "../../utils/abort.ts";
import type { AuthEvent, OAuthAuth } from "../types.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";

/** Pi's public Copilot client, not a Nyte-owned OAuth application. */
const DEFAULT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const DEVICE_CODE_LIFETIME_SECONDS = 15 * 60;

const EXPIRED_MESSAGE = "The device code expired before GitHub approved it. Sign in again.";

const CREDENTIAL_ERROR =
  "Invalid stored GitHub Copilot credential. Sign in to GitHub Copilot again.";

const KNOWN_GRANT_ERRORS = new Set([
  "unsupported_grant_type",
  "incorrect_client_credentials",
  "incorrect_device_code",
  "device_flow_disabled",
]);

const DeviceCodeResponse = Type.Object({
  device_code: Type.String({ minLength: 1 }),
  user_code: Type.String({ minLength: 1 }),
  verification_uri: Type.String({ minLength: 1 }),
  interval: Type.Optional(Type.Unknown()),
  expires_in: Type.Optional(Type.Unknown()),
});

const GitHubToken = Type.Object({ access_token: Type.String({ minLength: 1 }) });

const GrantError = Type.Object({ error: Type.String(), interval: Type.Optional(Type.Unknown()) });

const PositiveSeconds = Type.Number({ exclusiveMinimum: 0 });

const CopilotToken = Type.Object({
  token: Type.String({ minLength: 1 }),
  expires_at: Type.Number(),
});

const CopilotCredential = Type.Object({
  type: Type.Literal("oauth"),
  refresh: Type.String({ minLength: 1 }),
  access: Type.String({ minLength: 1 }),
  expires: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  availableModelIds: Type.Array(Type.String({ minLength: 1 })),
});

export interface GitHubCopilotOAuthOptions {
  fetch?: FetchFunction;
  /** The client must be permitted to use Copilot's session-token exchange. */
  clientId?: string;
}

/** Credential storage is an external boundary, including provider-specific metadata. */
export function isGitHubCopilotCredential(
  value: unknown,
): value is Static<typeof CopilotCredential> {
  return Value.Check(CopilotCredential, value);
}

function copilotOrigin(token: string): string {
  const proxy = /(?:^|;)proxy-ep=([^;]+)/u.exec(token)?.[1];

  if (proxy === undefined) return GITHUB_COPILOT_DEFAULT_ORIGIN;
  const url = URL.parse(`https://${proxy.replace(/^proxy\./u, "api.")}`);

  if (
    !url ||
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".githubcopilot.com") ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("GitHub Copilot token contains an untrusted API endpoint");
  }

  return url.origin;
}

/** Both fetch and body reading share a deadline; remote error text never reaches a login UI. */
async function requestCopilot(input: {
  fetch: FetchFunction | undefined;
  url: string;
  init: RequestInit;
  signal: AbortSignal;
  describe: string;
}): Promise<unknown> {
  const bounded = AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]);
  let response: Response;

  try {
    response = await raceWithAbortSignal(
      (input.fetch ?? globalThis.fetch)(input.url, {
        ...input.init,
        signal: bounded,
        redirect: "error",
      }),
      bounded,
    );
  } catch (error) {
    if (input.signal.aborted) throw new Error("Login cancelled", { cause: error });

    if (bounded.aborted) throw new Error(`${input.describe} timed out`, { cause: error });
    throw new Error(`${input.describe} failed: network error`, { cause: error });
  }

  if (!response.ok) throw new Error(`${input.describe} failed (HTTP ${String(response.status)})`);

  try {
    return await raceWithAbortSignal<unknown>(response.json(), bounded);
  } catch (error) {
    if (input.signal.aborted) throw new Error("Login cancelled", { cause: error });

    if (bounded.aborted) throw new Error(`${input.describe} timed out`, { cause: error });
    throw new Error(`${input.describe} returned an unreadable response`, { cause: error });
  }
}

const DEVICE_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": GITHUB_COPILOT_HEADERS["User-Agent"],
} as const;

async function startDeviceAuthorization(input: {
  fetch: FetchFunction | undefined;
  clientId: string;
  signal: AbortSignal;
}) {
  const json = await requestCopilot({
    fetch: input.fetch,
    url: "https://github.com/login/device/code",
    init: {
      method: "POST",
      headers: DEVICE_HEADERS,
      body: new URLSearchParams({ client_id: input.clientId, scope: "read:user" }),
    },
    signal: input.signal,
    describe: "GitHub device code request",
  });

  if (!Value.Check(DeviceCodeResponse, json))
    throw new Error("GitHub device code response is missing required fields");
  const url = URL.parse(json.verification_uri);

  if (
    !url ||
    url.protocol !== "https:" ||
    (url.hostname !== "github.com" && url.hostname !== "www.github.com") ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith("/login/")
  ) {
    throw new Error("GitHub device code response named a verification page outside github.com");
  }

  return {
    ...json,
    verification_uri: url.href,
    interval: Value.Check(PositiveSeconds, json.interval) ? json.interval : undefined,
    expires_in: Math.min(
      DEVICE_CODE_LIFETIME_SECONDS,
      Value.Check(PositiveSeconds, json.expires_in)
        ? json.expires_in
        : DEVICE_CODE_LIFETIME_SECONDS,
    ),
  };
}

async function pollForGitHubToken(input: {
  fetch: FetchFunction | undefined;
  clientId: string;
  device: Awaited<ReturnType<typeof startDeviceAuthorization>>;
  signal: AbortSignal;
}): Promise<Static<typeof GitHubToken>> {
  const lifetime = AbortSignal.timeout(Math.ceil(input.device.expires_in * 1000));
  const pollSignal = AbortSignal.any([input.signal, lifetime]);

  try {
    return await pollOAuthDeviceCodeFlow<Static<typeof GitHubToken>>({
      intervalSeconds: input.device.interval,
      expiresInSeconds: input.device.expires_in,
      waitBeforeFirstPoll: true,
      signal: pollSignal,
      poll: async () => {
        const json = await requestCopilot({
          fetch: input.fetch,
          url: "https://github.com/login/oauth/access_token",
          init: {
            method: "POST",
            headers: DEVICE_HEADERS,
            body: new URLSearchParams({
              client_id: input.clientId,
              device_code: input.device.device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          },
          signal: pollSignal,
          describe: "GitHub device authorization",
        });

        if (Value.Check(GitHubToken, json)) return { status: "complete", value: json };

        if (!Value.Check(GrantError, json))
          return { status: "failed", message: "GitHub device authorization response is malformed" };

        switch (json.error) {
          case "authorization_pending":
            return { status: "pending" };
          case "slow_down":
            return {
              status: "slow_down",
              intervalSeconds: Value.Check(PositiveSeconds, json.interval)
                ? json.interval
                : undefined,
            };
          case "expired_token":
            return { status: "failed", message: EXPIRED_MESSAGE };
          case "access_denied":
            return { status: "failed", message: "GitHub sign-in was denied." };
          default:
            return {
              status: "failed",
              message: KNOWN_GRANT_ERRORS.has(json.error)
                ? `GitHub device authorization failed: ${json.error}`
                : "GitHub device authorization failed with an unrecognized error",
            };
        }
      },
    });
  } catch (error) {
    if (input.signal.aborted) throw new Error("Login cancelled", { cause: error });

    if (lifetime.aborted) throw new Error(EXPIRED_MESSAGE, { cause: error });
    throw error;
  }
}

/** A GitHub grant and a Copilot session have different shapes, so they cannot be interchanged. */
async function loadCopilotCredential(input: {
  fetch: FetchFunction | undefined;
  github: Static<typeof GitHubToken>;
  knownModelIds: ReadonlySet<string>;
  signal: AbortSignal;
}) {
  const token = await requestCopilot({
    fetch: input.fetch,
    url: "https://api.github.com/copilot_internal/v2/token",
    init: {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.github.access_token}`,
        ...GITHUB_COPILOT_HEADERS,
      },
    },
    signal: input.signal,
    describe: "GitHub Copilot token exchange",
  });

  if (
    !Value.Check(CopilotToken, token) ||
    !Number.isSafeInteger(token.expires_at * 1000) ||
    token.expires_at * 1000 <= Date.now()
  ) {
    throw new Error(
      "GitHub Copilot token exchange returned an invalid token or expiry. Sign in to GitHub Copilot again.",
    );
  }

  const origin = copilotOrigin(token.token);

  const catalog = parseGitHubCopilotCatalog(
    await requestCopilot({
      fetch: input.fetch,
      url: `${origin}/models`,
      init: {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token.token}`,
          ...GITHUB_COPILOT_HEADERS,
          "X-GitHub-Api-Version": GITHUB_COPILOT_API_VERSION,
        },
      },
      signal: input.signal,
      describe: "GitHub Copilot catalog request",
    }),
    origin,
    input.knownModelIds,
  );

  input.signal.throwIfAborted();

  return {
    credential: {
      type: "oauth",
      refresh: input.github.access_token,
      access: token.token,
      // Shared auth resolution already refreshes five minutes before this actual expiry.
      expires: token.expires_at * 1000,
      availableModelIds: catalog.availableModelIds,
    } satisfies Static<typeof CopilotCredential>,
    needsApproval: catalog.needsApproval,
  };
}

export function githubCopilotOAuth(
  options: GitHubCopilotOAuthOptions = {},
  knownModelIds: () => ReadonlySet<string> = () => new Set(),
): OAuthAuth {
  return {
    name: "GitHub Copilot",
    isSubscription: true,
    loginLabel: "Sign in with GitHub",
    login: async (interaction) => {
      interaction.signal.throwIfAborted();

      const environment =
        typeof process === "undefined" ? undefined : process.env.NYTE_GITHUB_COPILOT_CLIENT_ID;

      const clientId = options.clientId || environment || DEFAULT_CLIENT_ID;

      const device = await startDeviceAuthorization({
        fetch: options.fetch,
        clientId,
        signal: interaction.signal,
      });

      if (interaction.signal.aborted) throw new Error("Login cancelled");

      const deviceCode: Extract<AuthEvent, { type: "device_code" }> = {
        type: "device_code",
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        intervalSeconds: device.interval,
        expiresInSeconds: device.expires_in,
      };

      if (clientId === DEFAULT_CLIENT_ID) {
        deviceCode.instructions = "This sign-in uses GitHub's Copilot app, not a Nyte OAuth app.";
      }

      interaction.notify(deviceCode);

      const github = await pollForGitHubToken({
        fetch: options.fetch,
        clientId,
        device,
        signal: interaction.signal,
      });

      interaction.notify({ type: "progress", message: "Connecting to GitHub Copilot" });

      const result = await loadCopilotCredential({
        fetch: options.fetch,
        github,
        knownModelIds: knownModelIds(),
        signal: interaction.signal,
      });

      if (result.needsApproval)
        interaction.notify({
          type: "info",
          message:
            "Some Copilot models need account approval. Enable them in your Copilot settings, then sign in again.",
        });

      return result.credential;
    },
    refresh: async (previous, signal) => {
      if (!isGitHubCopilotCredential(previous)) throw new Error(CREDENTIAL_ERROR);

      const result = await loadCopilotCredential({
        fetch: options.fetch,
        github: { access_token: previous.refresh },
        knownModelIds: knownModelIds(),
        signal,
      });

      return result.credential;
    },
    async toAuth(credential) {
      if (!isGitHubCopilotCredential(credential)) throw new Error(CREDENTIAL_ERROR);

      return {
        apiKey: credential.access,
        baseUrl: copilotOrigin(credential.access),
        headers: GITHUB_COPILOT_HEADERS,
      };
    },
  };
}
