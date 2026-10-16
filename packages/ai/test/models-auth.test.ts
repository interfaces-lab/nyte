import { describe, expect, it, vi } from "vitest";
import { storedAccounts } from "./credential-fixture.ts";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import type { ApiKeyAuth, CredentialStore, OAuthCredential } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import {
  testModel,
  type ProviderCall,
  testProvider,
  context,
  envKeyAuth,
  testOAuth,
} from "./models-fixture.ts";

describe("Models runtime auth", () => {
  it("passes caller signals to provider auth callbacks", async () => {
    const controller = new AbortController();
    const received: AbortSignal[] = [];
    const apiKey: ApiKeyAuth = {
      name: "Signal auth",
      login: async (interaction) => {
        received.push(interaction.signal);
        return { type: "api_key", key: "saved" };
      },
      check: async (input) => {
        received.push(input.signal);
        return { type: "api_key" };
      },
      resolve: async (input) => {
        received.push(input.signal);
        return { auth: { apiKey: "resolved" } };
      },
    };
    const models = createModels();
    models.setProvider(testProvider({ id: "p1", auth: { apiKey } }));

    await models.checkAuth("p1", { signal: controller.signal });
    await models.getAuth("p1", { signal: controller.signal });
    await models.login("p1", "api_key", {
      signal: controller.signal,
      prompt: async () => "unused",
      notify: () => {},
    });

    expect(received).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it("stops waiting for non-cooperative auth callbacks", async () => {
    let startCheck: (() => void) | undefined;
    let finishCheck: (() => void) | undefined;
    const checkStarted = new Promise<void>((resolve) => {
      startCheck = resolve;
    });
    const blockedCheck = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    let startResolve: (() => void) | undefined;
    let finishResolve: (() => void) | undefined;
    const resolveStarted = new Promise<void>((resolve) => {
      startResolve = resolve;
    });
    const blockedResolve = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });
    const models = createModels();
    models.setProvider(
      testProvider({
        id: "p1",
        auth: {
          apiKey: {
            name: "Blocked auth",
            check: async () => {
              startCheck?.();
              await blockedCheck;
              return { type: "api_key" };
            },
            resolve: async () => {
              startResolve?.();
              await blockedResolve;
              return { auth: { apiKey: "key" } };
            },
          },
        },
      }),
    );

    const availableController = new AbortController();
    const available = models.getAvailable(undefined, { signal: availableController.signal });
    await checkStarted;
    availableController.abort();
    await expect(available).rejects.toMatchObject({ name: "AbortError" });

    const authController = new AbortController();
    const auth = models.getAuth("p1", { signal: authController.signal });
    await resolveStarted;
    authController.abort();
    await expect(auth).rejects.toMatchObject({ name: "AbortError" });

    finishCheck?.();
    finishResolve?.();
  });

  it("cancels queued credential mutations without running them later", async () => {
    const credentials = new InMemoryCredentialStore();
    let finishFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let secondRan = false;
    const first = credentials.modify("p1", async () => {
      await firstBlocked;
      return storedAccounts({ type: "api_key", key: "first" });
    });
    const controller = new AbortController();
    const second = credentials.modify(
      "p1",
      async () => {
        secondRan = true;
        return storedAccounts({ type: "api_key", key: "second" });
      },
      { signal: controller.signal },
    );

    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    finishFirst?.();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(secondRan).toBe(false);
    expect(await credentials.read("p1")).toEqual(storedAccounts({ type: "api_key", key: "first" }));
  });

  it("passes cancellation to OAuth refresh and keeps a token that rotated anyway", async () => {
    const credentials = new InMemoryCredentialStore();
    const previous: OAuthCredential = {
      type: "oauth",
      access: "old",
      refresh: "old-refresh",
      expires: 0,
    };
    await credentials.modify("p1", async () => storedAccounts(previous));
    let startRefresh: (() => void) | undefined;
    let finishRefresh: ((credential: typeof previous) => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      startRefresh = resolve;
    });
    const blockedRefresh = new Promise<typeof previous>((resolve) => {
      finishRefresh = resolve;
    });
    let receivedSignal: AbortSignal | undefined;
    const models = createModels({ credentials });
    models.setProvider(
      testProvider({
        id: "p1",
        auth: {
          oauth: testOAuth({
            refresh: async (_credential, signal) => {
              receivedSignal = signal;
              startRefresh?.();
              return blockedRefresh;
            },
          }),
        },
      }),
    );
    const controller = new AbortController();
    const auth = models.getAuth("p1", { signal: controller.signal });
    await refreshStarted;
    controller.abort();

    await expect(auth).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedSignal?.reason).toBe(controller.signal.reason);
    const rotated = { ...previous, access: "new", expires: Date.now() + 60_000 };
    finishRefresh?.(rotated);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await credentials.read("p1")).toEqual(storedAccounts(rotated));
  });

  it("resolves auth: stored credential owns the provider, ambient only when nothing stored", async () => {
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(
      testProvider({ id: "p1", auth: { apiKey: envKeyAuth("env-key"), oauth: testOAuth() } }),
    );
    const model = testModel("p1", "model-a");

    expect((await models.getAuth(model))?.auth.apiKey).toBe("env-key");
    expect((await models.getAuth(model.provider))?.auth.apiKey).toBe("env-key");
    expect((await models.getAuth(model, { apiKey: "explicit-key" }))?.auth.apiKey).toBe(
      "explicit-key",
    );

    await credentials.modify("p1", async () =>
      storedAccounts({
        type: "oauth",
        access: "oauth-token",
        refresh: "r",
        expires: Date.now() + 10 * 60_000,
      }),
    );
    const resolution = await models.getAuth(model.provider);
    expect(resolution?.auth.apiKey).toBe("oauth-token");
    expect(resolution?.source).toBe("OAuth");

    await credentials.modify("p1", async () =>
      storedAccounts({ type: "api_key", key: "stored-key" }),
    );
    const apiKeyResolution = await models.getAuth(model.provider);
    expect(apiKeyResolution?.auth.apiKey).toBe("stored-key");
    expect(apiKeyResolution?.source).toBe("stored");
  });

  it("checks provider auth without refreshing OAuth and filters available models", async () => {
    const credentials = new InMemoryCredentialStore();
    let refreshes = 0;
    const models = createModels({ credentials });
    models.setProvider(testProvider({ id: "ambient", auth: { apiKey: envKeyAuth("env-key") } }));
    models.setProvider(testProvider({ id: "missing", auth: { apiKey: envKeyAuth(undefined) } }));
    models.setProvider(
      testProvider({
        id: "oauth",
        auth: {
          oauth: testOAuth({
            refresh: async (credential) => {
              refreshes++;
              return credential;
            },
          }),
        },
      }),
    );
    await credentials.modify("oauth", async () =>
      storedAccounts({
        type: "oauth",
        access: "expired",
        refresh: "refresh",
        expires: 0,
      }),
    );

    expect(await models.checkAuth("ambient")).toEqual({ source: "env", type: "api_key" });
    expect(await models.checkAuth("missing")).toBeUndefined();
    expect(await models.checkAuth("oauth")).toEqual({ source: "OAuth", type: "oauth" });
    expect(refreshes).toBe(0);
    expect((await models.getAvailable()).map((model) => model.provider)).toEqual([
      "ambient",
      "oauth",
    ]);
    expect((await models.getAvailable("ambient")).map((model) => model.provider)).toEqual([
      "ambient",
    ]);
  });

  it("runs provider login and logout through the credential store", async () => {
    const credentials = new InMemoryCredentialStore();
    const apiKey = envKeyAuth(undefined);
    apiKey.login = async () => ({ type: "api_key", key: "logged-in" });
    const models = createModels({ credentials });
    models.setProvider(testProvider({ id: "p1", auth: { apiKey } }));

    const credential = await models.login(
      "p1",
      "api_key",
      { prompt: async () => "unused", notify: () => {} },
      " Work ",
    );
    expect(credential).toEqual({ type: "api_key", key: "logged-in" });
    expect(await credentials.read("p1")).toMatchObject({
      active: expect.any(String),
      accounts: [{ id: expect.any(String), label: "Work", credential }],
    });

    await models.logout("p1");
    expect(await credentials.read("p1")).toBeUndefined();
  });

  it.each(["", " \t\n"])("rejects a blank API key before saving an account", async (key) => {
    const models = createModels();
    models.setProvider(
      testProvider({
        id: "p1",
        auth: {
          apiKey: { ...envKeyAuth(undefined), login: async () => ({ type: "api_key", key }) },
        },
      }),
    );

    await expect(
      models.login("p1", "api_key", { prompt: async () => "Personal", notify: () => {} }),
    ).rejects.toThrow("Enter an API key.");
    expect(await models.listAccounts("p1")).toEqual([]);
  });

  it("a stored credential without a matching handler blocks ambient fallback", async () => {
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(testProvider({ id: "p1", auth: { apiKey: envKeyAuth("env-key") } }));
    await credentials.modify("p1", async () =>
      storedAccounts({
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: 0,
      }),
    );

    expect(await models.getAuth("p1")).toBeUndefined();
  });

  it.each([
    {
      label: "with less than five minutes remaining",
      expires: () => Date.now() + 60_000,
      options: undefined,
    },
    {
      label: "inside a caller's longer minimum validity",
      expires: () => Date.now() + 10 * 60_000,
      options: { minOAuthValidityMs: 30 * 60_000 },
    },
  ])(
    "refreshes oauth credentials $label and persists the rotated credential",
    async ({ expires, options }) => {
      const credentials = new InMemoryCredentialStore();
      const refresh = vi.fn(async (credential) => ({
        ...credential,
        access: "new-token",
        expires: Date.now() + 60 * 60_000,
      }));
      const models = createModels({ credentials });
      models.setProvider(testProvider({ id: "p1", auth: { oauth: testOAuth({ refresh }) } }));
      await credentials.modify("p1", async () =>
        storedAccounts({
          type: "oauth",
          access: "old-token",
          refresh: "r",
          expires: expires(),
        }),
      );

      expect((await models.getAuth("p1", options))?.auth.apiKey).toBe("new-token");
      expect(refresh).toHaveBeenCalledOnce();
      expect(await credentials.read("p1")).toMatchObject({
        accounts: [{ credential: { type: "oauth", access: "new-token" } }],
      });
    },
  );

  it("rejects with code oauth when refresh fails, keeping the reason and the stored credential", async () => {
    const credentials = new InMemoryCredentialStore();
    const oauth = testOAuth({
      refresh: async () => {
        throw new Error("token refresh failed (400): invalid_grant");
      },
    });
    const models = createModels({ credentials });
    models.setProvider(testProvider({ id: "p1", auth: { oauth } }));
    await credentials.modify("p1", async () =>
      storedAccounts({
        type: "oauth",
        access: "old",
        refresh: "r",
        expires: 0,
      }),
    );

    await expect(models.getAuth("p1")).rejects.toMatchObject({
      code: "oauth",
      message: "OAuth refresh failed for p1: token refresh failed (400): invalid_grant",
    });
    expect(await credentials.read("p1")).toMatchObject({
      accounts: [{ credential: { type: "oauth", access: "old" } }],
    });
  });

  it("serializes concurrent OAuth refreshes through store.modify (no double refresh)", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("p1", async () =>
      storedAccounts({
        type: "oauth",
        access: "old",
        refresh: "r1",
        expires: 0,
      }),
    );

    let refreshes = 0;
    const oauth = testOAuth({
      refresh: async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          type: "oauth",
          access: `new-${refreshes}`,
          refresh: "r2",
          expires: Date.now() + 60 * 60_000,
        };
      },
    });
    const models = createModels({ credentials });
    models.setProvider(testProvider({ id: "p1", auth: { oauth } }));
    const model = testModel("p1", "model-a");

    const [a, b] = await Promise.all([
      models.getAuth(model.provider),
      models.getAuth(model.provider),
    ]);
    expect(refreshes).toBe(1);
    expect(a?.auth.apiKey).toBe("new-1");
    expect(b?.auth.apiKey).toBe("new-1");
  });

  it.each(["request", "catalog"] as const)(
    "pins %s refresh to the account selected before a concurrent switch",
    async (kind) => {
      const base = new InMemoryCredentialStore();
      await base.modify("p1", async () => ({
        active: "personal",
        accounts: [
          {
            id: "personal",
            label: "Personal",
            credential: {
              type: "oauth",
              access: "personal-old",
              refresh: "personal-refresh",
              expires: 0,
            },
          },
          {
            id: "work",
            label: "Work",
            credential: {
              type: "oauth",
              access: "work-token",
              refresh: "work-refresh",
              expires: Date.now() + 60 * 60_000,
            },
          },
        ],
      }));
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      let waiting = true;
      const credentials: CredentialStore = {
        read: (provider, options) => base.read(provider, options),
        list: (options) => base.list(options),
        async modify(provider, fn, options) {
          if (waiting) {
            waiting = false;
            entered.resolve();
            await resume.promise;
          }

          return base.modify(provider, fn, options);
        },
        delete: (provider, options) => base.delete(provider, options),
      };
      const models = createModels({ credentials });
      let catalogAccess: string | undefined;
      models.setProvider(
        testProvider({
          id: "p1",
          auth: {
            oauth: testOAuth({
              refresh: async (credential) => ({
                ...credential,
                access: `${credential.access}-fresh`,
                expires: Date.now() + 60 * 60_000,
              }),
            }),
          },
          refreshModels: async (context) => {
            if (context.allowNetwork && context.credential?.type === "oauth")
              catalogAccess = context.credential.access;
          },
        }),
      );

      const auth = kind === "request" ? models.getAuth("p1") : undefined;
      const refresh = kind === "catalog" ? models.refresh() : undefined;
      await entered.promise;
      await base.modify("p1", async (current) =>
        current ? { ...current, active: "work" } : undefined,
      );
      resume.resolve();

      if (auth)
        expect(await auth).toMatchObject({
          accountId: "personal",
          auth: { apiKey: "personal-old-fresh" },
        });
      if (refresh) {
        expect((await refresh).errors.size).toBe(0);
        expect(catalogAccess).toBe("personal-old-fresh");
      }

      expect(await models.getAuth("p1")).toMatchObject({
        accountId: "work",
        auth: { apiKey: "work-token" },
      });
      expect(await models.listAccounts("p1")).toEqual([
        { providerId: "p1", id: "personal", label: "Personal", type: "oauth", active: false },
        { providerId: "p1", id: "work", label: "Work", type: "oauth", active: true },
      ]);
    },
  );

  it("valid oauth tokens resolve without touching modify", async () => {
    let modifies = 0;
    const base = new InMemoryCredentialStore();
    const credentials: CredentialStore = {
      read: (pid) => base.read(pid),
      list: () => base.list(),
      modify: (pid, fn) => {
        modifies++;
        return base.modify(pid, fn);
      },
      delete: (pid) => base.delete(pid),
    };
    await base.modify("p1", async () =>
      storedAccounts({
        type: "oauth",
        access: "valid",
        refresh: "r",
        expires: Date.now() + 10 * 60_000,
      }),
    );
    const models = createModels({ credentials });
    models.setProvider(testProvider({ id: "p1", auth: { oauth: testOAuth() } }));

    expect((await models.getAuth("p1"))?.auth.apiKey).toBe("valid");
    expect(modifies).toBe(0);
  });

  it("wraps credential store failures in ModelsError", async () => {
    const readFailing: CredentialStore = {
      read: async () => {
        throw new Error("disk on fire");
      },
      list: async () => [],
      modify: async () => undefined,
      delete: async () => {},
    };
    const models = createModels({ credentials: readFailing });
    models.setProvider(testProvider({ id: "p1", auth: { apiKey: envKeyAuth("env-key") } }));
    await expect(models.getAuth("p1")).rejects.toMatchObject({ code: "auth" });

    const modifyFailing: CredentialStore = {
      read: async () => storedAccounts({ type: "oauth", access: "old", refresh: "r", expires: 0 }),
      list: async () => [
        { providerId: "p1", type: "oauth", id: "default", label: "Default", active: true },
      ],
      modify: async () => {
        throw new Error("disk on fire");
      },
      delete: async () => {},
    };
    const oauthModels = createModels({ credentials: modifyFailing });
    oauthModels.setProvider(testProvider({ id: "p1", auth: { oauth: testOAuth() } }));
    await expect(oauthModels.getAuth("p1")).rejects.toMatchObject({ code: "auth" });
  });

  it("wraps api-key auth failures in ModelsError", async () => {
    const failing: ApiKeyAuth = {
      name: "Failing",
      resolve: async () => {
        throw new Error("nope");
      },
    };
    const models = createModels();
    models.setProvider(testProvider({ id: "p1", auth: { apiKey: failing } }));
    await expect(models.getAuth("p1")).rejects.toMatchObject({ code: "auth" });
  });

  it("uses explicit request api key and env during provider auth resolution", async () => {
    const calls: ProviderCall[] = [];
    const apiKey: ApiKeyAuth = {
      name: "Scoped",
      resolve: async (input) => {
        const account = input.credential?.env?.ACCOUNT_ID ?? (await input.ctx.env("ACCOUNT_ID"));
        if (!input.credential?.key || !account) return undefined;
        return {
          auth: { apiKey: input.credential.key, baseUrl: `https://example.test/${account}` },
          env: { ACCOUNT_ID: account },
        };
      },
    };
    const models = createModels();
    models.setProvider(testProvider({ id: "p1", auth: { apiKey }, calls }));
    const model = testModel("p1", "model-a");

    await models.completeSimple(model, context, {
      apiKey: "explicit-key",
      env: { ACCOUNT_ID: "acct" },
    });

    expect(calls[0].model.baseUrl).toBe("https://example.test/acct");
    expect(calls[0].options?.apiKey).toBe("explicit-key");
    expect(calls[0].options?.env).toEqual({ ACCOUNT_ID: "acct" });
  });
});
