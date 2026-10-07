/**
 * Nyte SDK review draft.
 *
 * Add comments above a function/type or beside a call in either section.
 * current* examples describe checkout c7094f5c; proposed* examples describe
 * the replacement API. reference* examples show pinned third-party SDK usage.
 * Names are kept stable for review.
 *
 * This is an import-free spec, not runnable code. Unresolved names stand for
 * the cited dependencies. No example runs at module load. Results are named so
 * you can comment on the returned value. Do not log credentials.
 *
 * Sections
 *   I. Current APIs, connectors and application code.
 *   II. Proposed contracts and usage.
 *   III. Decisions, sources, migration and checks.
 *
 * Notation
 *   field?: T           May be omitted; null requires an explicit union.
 *   field: T|undefined  Required property with a possibly absent value.
 *   field: T|null       Required property; its null meaning is documented.
 *   S                   Synchronous return. Does not imply no I/O.
 *   A                   Await the Promise before using its result.
 *   O                   Check the returned outcome; it is not the receiver.
 *   W / I               Iterate a stream; stop observation with return/abort.
 *   D                   Disposer function.
 *
 * Public = package export. Internal = source-only entry. Host-only = local
 * authority, not automatically available to remote clients.
 * Methods do not return their receiver unless stated. Bound handles do not
 * prove existence or own execution. Closing a view does not stop a run.
 * Missing, loading, unsupported and known-empty values remain distinct.
 * Part II uses Result<Success, Failure> for expected failures. Part I keeps the
 * current APIs' behavior. Effect is a source reference, never a dependency.
 *
 * Source revisions
 *   Nyte c7094f5cf79152337a3df50e5921d953cdd8e01f, package 0.0.16-dev.2.
 *   Pierre c1bc584644fb623d43b38025a428558133f787dc
 *   OpenCode v2 3ca0ac718bb4d93f5136196af6680089a6d88bd5
 *   Pi 28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9
 *   Effect v4 8409eb45925e23c10a9fb5b9bd31baaafca25d81, design reference only.
 *   Cursor @cursor/sdk 1.0.36; public cookbook
 *     6733ef81a7dc3cb2a6c1f524ff586ebecc703204.
 *   Rex docs superlogical.com/rex/docs, read 2026-10; config/actions/server-api
 *     pages, design reference only.
 * Sources
 *   https://github.com/pierrecomputer/sdk
 *   https://github.com/anomalyco/opencode/tree/v2
 *   https://github.com/earendil-works/pi
 *   https://github.com/Effect-TS/effect
 *   https://cursor.com/docs/sdk/typescript
 *   https://www.superlogical.com/rex/docs/customize/config
 * Implementation references are in Part III.
 */

// Part I. Current APIs

/**
 * Public @nyte-ai/core; kernel/sdk/nyte.ts:156; sdk/types.ts:603.
 * Required: store,streamFn,models,model,plugins,defaultWorkspace.
 * Optional: onDiagnostic,drain,actor,thinkingLevel,compaction,streamOptions,
 * cacheWarming getter,telemetry,workspace backend,trust callback. No null fields.
 */
async function currentCoreOpen(
  options: Omit<NyteOptions, "plugins" | "defaultWorkspace">,
  localWorkspace: Workspace,
) {
  const workspace = { kind: "local", id: localWorkspace.id, cwd: localWorkspace.cwd };
  const sdk = await createNyte({
    ...options,
    defaultWorkspace: workspace,
    plugins: [localEnvironmentPlugin({ id: workspace.id })],
  }); // A→Nyte, matching provider.
  // cwd must be absolute; pass prepared matching provider instead for nonlocal workspaces.
  try {
    const first = await sdk.sessions.create(); // optional input; uses host workspace.
    const second = await sdk.sessions.create({ name: "Named session" });
    const exact = await sdk.sessions.create({ sessionId: chosenId, name: "Exact ID" });
    // otherWorkspace must also be local with matching identity; otherwise activation is blocked.
    const relocatedRoot = await sdk.sessions.create({ workspace: otherWorkspace });
    const child = await sdk.sessions.create({ parent: sessionParent });
    // parent and workspace are mutually exclusive. Result field is sessionId.
    const sessionId = first.sessionId;
    const releaseDrive = sdk.attach({ sessions: [first.sessionId] }); // S→D.
    try {
      await sdk.messages.send({ sessionId: first.sessionId, content: "Hello", delivery: "next" });
      const runOutcome = await sdk.runs.wait({ sessionId: first.sessionId, signal });
    } finally {
      releaseDrive();
    } // Stops local drive, not durable Stop.
  } finally {
    await sdk.close();
  } // Does not close options.store or models.
}

/**
 * Public sdk/types.ts:589 WorkspaceTrust; the host's answer per workspace, asked once per open.
 * Sessions own their plugin reload: the answer's loader runs before every response and, when
 * `changes` fires, for every session active in the workspace and the prospective catalog.
 * There is no host-driven reload call. Reloads of one session land in order; a change that
 * arrives while a session activates is replayed once it is up.
 */
function currentCoreTrust(): NyteOptions["trust"] {
  return (workspace) =>
    workspace.cwd === grantedCwd
      ? {
          kind: "trusted",
          plugins: async (env) => projectPlugins(env), // Optional; may wrap env, never provide one. Throw → session failed; fixed sources recover it on the next change.
          changes: (notify) => watchSources(notify), // Optional; D. Sync notify is fine; one listener per active session plus the catalog.
        }
      : { kind: "requires", requirement: { kind: "workspace_trust", cwd: workspace.cwd } }; // or { kind: "inactive" }.
  // A failed reload is a `plugins` diagnostic on that session; a reload during an active call is queued until it ends.
}

/**
 * Public sdk/types.ts:195; protocol/sdk.ts:115; all methods A, nonfluent.
 */
async function currentCoreSessions(sdk: Nyte, id: SessionId) {
  const sessionInfo = await sdk.sessions.get({ sessionId: id }); // SessionInfo|undefined, not null.
  const snapshot = await sdk.sessions.snapshot({ sessionId: id }); // undefined if absent.
  const metadata = await sdk.sessions.metadata({ sessionId: id, head: "main" });
  const sessions = await sdk.sessions.list(); // optional whole input.
  const sessions2 = await sdk.sessions.list({ search: "demo", limit: 20, includeArchived: true });
  const roots = await sdk.sessions.list({ parent: null }); // null selects roots.
  const children = await sdk.sessions.list({ parent: id }); // omitted parent means all.
  if (roots.next !== undefined) {
    const sessions3 = await sdk.sessions.list({ cursor: roots.next });
  }
  // Page.items, Page.next?:string; not cursor:null.
  await sdk.sessions.rename({ sessionId: id, name: "Renamed" }); // Promise<void>.
  await sdk.sessions.setPinned({ sessionId: id, pinned: true });
  await sdk.sessions.setArchived({ sessionId: id, archived: false });
  const configurationOutcome = await sdk.sessions.configure({
    sessionId: id,
    model: { provider: "openai", id: modelId },
  });
  const configurationOutcome2 = await sdk.sessions.configure({
    sessionId: id,
    head: "main",
    thinkingLevel: "medium",
    agent: agentId,
  });
  // configure is passive durable admission, not mutation of an in-flight request.
  await sdk.sessions.delete({ sessionId: disposableSessionId }); // nonchainable void.
}

/**
 * Public sdk/types.ts:238; protocol/operations.ts:159; nyte.ts:410.
 * SendInput: sessionId,head?,content,delivery?,key?,agent?,source?.
 * content is string or UserContent blocks; not message/text payload fields.
 */
async function currentCoreMessages(sdk: Nyte, id: SessionId) {
  const queued = await sdk.messages.send({
    sessionId: id,
    content: "After this run",
    delivery: "next",
    key: admissionKey,
  });
  const again = await sdk.messages.send({
    sessionId: id,
    content: "After this run",
    delivery: "next",
    key: admissionKey,
  });
  const steer = await sdk.messages.send({
    sessionId: id,
    head: "main",
    content: "At the next boundary",
    delivery: "steer",
  });
  // admission receipts, not responses; duplicate key is durable.
  const receipt = await sdk.messages.send({
    sessionId: id,
    content: userContent,
    agent: agentId,
    source: messageSource,
  });
  // Omitted delivery: live→steer, idle→next. Neither interrupts streaming.
  const receipt2 = await sdk.messages.send({
    sessionId: id,
    content: "Use current default delivery",
  });
  const pendingInputs = await sdk.messages.pending({ sessionId: id }); // local-only A.
  const turns = await sdk.messages.list({ sessionId: id, head: "main" }); // local-only A.
  const redeliveryOutcome = await sdk.messages.redeliver({
    sessionId: id,
    change: pendingOid,
    delivery: "steer",
  });
  // before omitted preserves position; null explicitly moves to end.
  const redeliveryOutcome2 = await sdk.messages.redeliver({
    sessionId: id,
    change: pendingOid,
    delivery: "next",
    before: null,
  });
  const redeliveryOutcome3 = await sdk.messages.redeliver({
    sessionId: id,
    change: pendingOid,
    delivery: "next",
    before: otherPendingOid,
    content: "Edited",
  });
  const cancellationOutcome = await sdk.messages.cancel({ sessionId: id, change: pendingOid });
  // All A/nonchainable. A queued admission needs attach, advance, or a scheduler.
}

/**
 * Public sdk/types.ts:272; protocol/operations.ts:209; nyte.ts:546,577.
 */
async function currentCoreRuns(sdk: Nyte, id: SessionId) {
  const currentRun = await sdk.runs.current({ sessionId: id }); // RunInfo|undefined, not null.
  const stopOutcome = await sdk.runs.abort({ sessionId: id, head: "main", runId: exactRunId });
  const stopOutcome2 = await sdk.runs.abort({ sessionId: id }); // omit runId targets current head.
  // Stop is one-way; children continue; user-owned jobs are not run-owned.
  const runOutcome = await sdk.runs.wait({ sessionId: id, signal }); // local-only; abort wait ≠ Stop.
  const replyOutcome = await sdk.runs.reply({
    sessionId: id,
    runId: exactRunId,
    callId,
    waitId,
    reply: replyData,
  });
  // waitId required exact parked generation, reply JsonValue; no user message insertion.
  const replyOutcome2 = await sdk.runs.reply({ sessionId: id, callId, waitId, reply: null });
  // JsonValue explicitly permits null; optional runId/head do not.
  const compactionOutcome = await sdk.runs.compact({
    sessionId: id,
    customInstructions: "Keep decisions",
    signal,
  });
  const context = await sdk.runs.context({ sessionId: id }); // local-only context read.
  // diff/revert are filesystem attribution, not conversation branch navigation.
  const runChanges = await sdk.runs.diff({ sessionId: id, runs: [exactRunId] });
  const restoreOutcome = await sdk.runs.revert({
    sessionId: id,
    runId: exactRunId,
    expect: observedTreeId,
  });
  // All A/nonchainable; revert expect:TreeId is required, not optional/null.
}

/**
 * Public protocol/operations.ts:194; sdk/types.ts:307 alias RemoteJobs.
 */
async function currentCoreJobs(sdk: Nyte, id: SessionId) {
  const job = await sdk.jobs.start({ sessionId: id, head: "main", command: "printf demo" });
  // A→JobInfo, bash tool, no model run/continuation.
  const jobsList = await sdk.jobs.list({ sessionId: id });
  const jobsBackgroundOutcome = await sdk.jobs.background({ sessionId: id, jobId });
  const jobsCancelOutcome = await sdk.jobs.cancel({ sessionId: id, jobId });
  // Start head defaults main; list without head spans heads. jobId is required.
  // User-owned start survives runs.abort, not SDK/host close. All nonfluent.
  // Background state remains after terminal completion; no restart replay guarantee.
  // This is not PTY input/resize, interactive terminal ownership, or browser automation.
}

/**
 * Public sdk/types.ts:311; nyte.ts:630; stack implementation stacks.ts:114.
 */
async function currentCoreHeads(sdk: Nyte, id: SessionId) {
  const heads = await sdk.heads.list({ sessionId: id }); // A, local-only retained heads.
  const branchOutcome = await sdk.heads.create({
    sessionId: id,
    head: "experiment",
    from: { head: "main" },
  });
  const branchOutcome2 = await sdk.heads.create({
    sessionId: id,
    head: "from-commit",
    from: { commit: selectedOid },
  });
  // Public from.commit cannot be null; internal createHead permits null separately.
  const navigationOutcome = await sdk.heads.move({
    sessionId: id,
    head: "experiment",
    to: selectedOid,
    expect: observedTip,
  });
  const navigationOutcome2 = await sdk.heads.move({
    sessionId: id,
    head: "experiment",
    to: null,
    expect: null,
  });
  // to:null→unborn; expect:null→expect unborn; omitted expect→no caller expectation.
  const navigationOutcome3 = await sdk.heads.move({
    sessionId: id,
    to: selectedOid,
    summary: { customInstructions: "Carry decisions" },
  });
  // Selected user node restores content and moves to parent; not auto-resend.
  const mergeOutcome = await sdk.heads.merge({ sessionId: id, head: "experiment" });
  const deletionOutcome = await sdk.heads.delete({ sessionId: id, head: "from-commit" });
  // Merge is stack-parent fast-forward, not generic content conflict resolution.
  // Every method A/nonfluent. Only heads.move is available remotely.
  // /tree all retained commits/projection/navigation demo: workbench examples.
}

/**
 * Public sdk/types.ts:477,491; these are projections/actions, not registries.
 */
async function currentCoreProviderPlugins(sdk: Nyte, id: SessionId) {
  const availableModels = await sdk.provider.models.list();
  const defaultModel = await sdk.provider.models.default(); // ModelInfo|undefined, not null.
  const authentication = await sdk.provider.status(); // proves credential with non-generating request.
  const pluginCatalog = await sdk.plugins.catalog(); // prospective catalog; can fail workspace activation.
  const plugins = await sdk.plugins.list({ sessionId: id });
  const commands = await sdk.plugins.commands.list({ sessionId: id });
  const commandOutcome = await sdk.plugins.commands.run({
    sessionId: id,
    name: commandName,
    argument: "demo",
  });
  const commandOutcome2 = await sdk.plugins.commands.run({ sessionId: id, name: commandName }); // argument?.
  const settingsList = await sdk.plugins.settings.list({ sessionId: id });
  const settingOutcome = await sdk.plugins.settings.apply({
    sessionId: id,
    id: settingId,
    choiceId,
  });
  const resources = await sdk.plugins.resources.list({ sessionId: id });
  const statusItems = await sdk.plugins.status.list({ sessionId: id });
  // All A/nonchainable, no null option fields. Full Models auth is another capability.
}

/**
 * Public sdk/types.ts:649; nyte.ts:1087,1152,1169,1215.
 * This demonstration accepts ownership of sdk; its supplied Store stays borrowed.
 */
async function currentCoreRoots(sdk: Nyte, id: SessionId) {
  const all = sdk.attach(); // S disposer; includes future store sessions.
  try {
    const subset = sdk.attach({ sessions: [id] });
    try {
      const advanceResult = await sdk.advance({ sessionId: id, head: "main", signal });
      const sessionCwdResult = await sdk.sessionCwd({ sessionId: id }); // Promise<string|undefined>.
      const sessionWorkspaceResult = await sdk.sessionWorkspace({ sessionId: id }); // Promise<Workspace>.
      const relocateResult = await sdk.relocate({ sessionId: id, workspace: otherWorkspace });
      await sdk.reactivate();
      const cacheWarmingValue = sdk.cacheWarming.status({ sessionId: id });
      sdk.cacheWarming.modeChanged();
    } finally {
      subset();
    } // Cleanup even if advancement/activation rejects.
  } finally {
    try {
      all();
    } finally {
      await sdk.close();
    } // Attempt every owner.
  }
  await sdk.close(); // Idempotence demo; successful prior close does not close Store.
}

/**
 * Public core/store.ts:1; sqlite.ts:1036,1128; worker-store.ts:57,492,525.
 */
async function currentStoreOpeners() {
  const file = new SqliteStore(databasePath); // S; path required, options optional.
  try {
    const fileList = await file.list();
  } finally {
    await file.close();
  }
  const connected = new SqlStore(sqliteConnection, { watchPollIntervalMs: 250 });
  try {
    const connectedList = await connected.list();
  } finally {
    await connected.close();
  }
  // SqlStore owns optional connection.close; confirm ownership when supplying it.
  const worker = new WorkerStore({ path: databasePath, worker: storeWorkerEntry });
  try {
    await worker.ready();
    const workerList = await worker.list();
  } finally {
    await worker.close();
  } // terminates worker; constructor not await-first.
  // Public core/postgres.ts:1; postgres/store.ts:13,110; database.ts:44.
  const wrapped = postgresDatabase(pool); // S; wrapped.close ends supplied pool.
  const postgres = new PostgresStore(wrapped, { watchPollIntervalMs: 250 });
  try {
    await postgres.initialize();
    const postgresList = await postgres.list();
  } finally {
    await postgres.close();
  }
  const opened = await openPostgresStore({ ...poolConfig, onPoolError }); // A initialized.
  try {
    const openedList = await opened.list();
  } finally {
    await opened.close();
  }
  // No chaining: constructor→store; ready/initialize/close→Promise<void>.
  // No null options; /store-worker and /image-resize-worker are executable entries.
  // Public durableSqlite(CF storage) seam demonstrated with deployment below.
}

/**
 * Public kernel/store.ts:31,60,83,98,120,155; raw escape, not SDK coordination.
 */
async function currentStoreAuthorities(store: Store) {
  const created = await store.create({ id: rawStoreSessionId }); // id:string, not sessionId.
  await created.close(); // closes handle, not durable record.
  const session = await store.open(rawStoreSessionId); // A; unknown throws UnknownSession.
  try {
    const oids = await session.objects.put(objects); // A→OID array, idempotent content.
    const object = await session.objects.get(objectOid); // Obj|undefined, not null.
    const chainResult = await session.objects.chain(objectOid, { limit: 100 });
    const objects2 = await session.objects.list();
    const commits = await session.objects.commits();
    const tip = await session.refs.read(refName); // Oid|null: missing ref is NULL.
    const refs = await session.refs.list("refs/heads/");
    const refOutcome = await session.refs.update([{ name: refName, from: tip, to: tip }], {
      reason: "assert",
    });
    // from===to assertion writes no event; to:null deletes; fence runner writes.
    const refOutcome2 = await session.refs.update(refUpdates, {
      reason: "demo",
      lease,
      actor,
      events: eventBodies,
    });
    const leaseOutcome = await session.leases.acquire(leaseName, 30_000); // losing is an outcome.
    const holder = await session.leases.read(leaseName); // live Lease|undefined, not null.
    const renewalOutcome = await session.leases.renew(lease, 30_000);
    const releaseOutcome = await session.leases.release(lease);
    const appendOutcome = await session.events.append(eventBodies, { lease }); // ok/seq or fenced.
    const events = await session.events.read({ afterSeq: sequence, limit: 100 });
    const lastSequence = await session.events.last();
    const retentionFloor = await session.events.floor();
    for await (const event of session.events.watch({ afterSeq: sequence, signal })) {
      // Handle event here.
    }
    const listing = await session.listing.read(); // derived cache|undefined, no authority.
    await session.listing.write(storedListing); // {seq,body:string}, no event.
    // all raw reads/writes A, watch I, nonfluent.
  } finally {
    await session.close();
  }
  await store.delete(disposableRawSessionId); // unknown no-op; destructive example only.
  // objects.delete and events.trim are collector operations demonstrated below.
}

/**
 * Public ai/index.ts:115–131; models.ts:1041,1070; nyte-catalog.ts:44.
 */
async function currentModelsFactories() {
  const models = createModels({
    credentials,
    modelsStore,
    authContext,
    catalog: { url: catalogUrl, fetch: catalogFetch },
  });
  const standard = createNyteModels(); // S; file stores + all eight providers.
  const providers = [
    anthropicProvider(),
    openaiProvider(),
    openaiCodexProvider(),
    githubCopilotProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
    openrouterProvider(),
    vercelAiGatewayProvider(),
  ]; // all real public factories; no Grok and no exported googleProvider factory.
  const custom = createProvider({
    id: "example",
    name: "Example",
    auth: providerAuth,
    api: providerStreams,
  });
  const mixed = createProvider({ id: "mixed", auth: providerAuth, api: apiImplementations });
  // Optional createProvider: name,baseUrl,headers,promptCache,filterModels. No models field.
  for (const provider of providers) models.setProvider(provider); // V, cannot chain.
  models.setProvider(custom);
  models.setProvider(mixed);
  const view = models.withProvider(custom); // S→independent Models registry, shared stores.
  models.deleteProvider("mixed");
  models.clearProviders(); // V, not receiver returns.
  const copilot = githubCopilotProvider(copilotOAuthOptions); // options optional, not null.

  // All factories S; catalog can be empty until refresh; models has NO close().
}

/**
 * Public ai/models.ts:190–295. S reads; A auth/catalog; S stream objects.
 */
async function currentModelsOperations(models: MutableModels, model: Model<Api>, context: Context) {
  const providers = models.getProviders();
  const provider = models.getProvider(providerId); // missing→undefined.
  const catalogModels = models.getModels();
  const catalogModels2 = models.getModels(providerId); // provider optional, not null.
  const selectedModel = models.getModel(providerId, modelId);
  const accountLimits = models.getAccountLimits(providerId);
  const refreshResult = await models.refresh();
  const refreshResult2 = await models.refresh({ providers: [providerId], allowNetwork: false });
  const authCheck = await models.checkAuth(providerId, { signal });
  const authVerification = await models.verifyAuth(providerId, { signal });
  const availableModels = await models.getAvailable(providerId, { signal });
  const availableModels2 = await models.getAvailable(); // provider/options optional; no null sentinel.
  const auth = await models.getAuth(providerId, { signal }); // overload by provider ID.
  const auth2 = await models.getAuth(model, { signal }); // overload by Model; undefined unconfigured.
  const loginResult = await models.login(providerId, "api_key", authInteraction);
  const loginResult2 = await models.login(providerId, "oauth", authInteraction);
  await models.logout(providerId, { signal });
  const raw = models.stream(model, context, apiOptions); // S→AssistantMessageEventStream.
  for await (const event of raw) {
    // Handle event here.
  }
  const result = await raw.result(); // error can be assistant stopReason, not thrown.
  const completion = await models.complete(model, context, apiOptions);
  const simple = models.streamSimple(model, context, { signal }); // S stream, not Promise.
  for await (const event of simple) {
    // Handle event here.
  }
  const completion2 = await models.completeSimple(model, context, { signal });
  const deferredResult = await models.fetchDeferred(model, deferredHandle, deferredFetchOptions);
  await models.cancelDeferred(model, deferredHandle, deferredCancelOptions);
  // Not all providers support deferred handles; methods are nonfluent.
}

/**
 * Public ai/auth/types.ts:27,86,120; credential-store.ts; auth/store.ts:251.
 */
async function currentProviderAuthStores() {
  const memory = new InMemoryCredentialStore(); // S, no closer.
  const file = new FileCredentialStore(authPath); // path optional defaultAuthPath().
  const defaultAuthPathResult = defaultAuthPath();
  const memoryList = await memory.list({ signal });
  const fileValue = await file.read(providerId, { signal }); // Credential|undefined, not null.
  await file.modify(providerId, async () => ({ type: "api_key", key: secretKey }), { signal });
  await file.modify(providerId, async (current) => current, { signal });
  await file.modify(providerId, async () => undefined); // leave unchanged, not delete.
  await file.delete(providerId, { signal }); // explicit removal; all operations A.
  const modelMemory = new InMemoryModelsStore();
  const modelFile = new FileModelsStore(modelsPath); // optional defaultModelsStorePath().
  const defaultModelsStorePathResult = defaultModelsStorePath();
  const modelMemoryValue = await modelMemory.read(providerId, { signal });
  await modelMemory.write(providerId, { models: catalogModels }, { signal });
  await modelFile.write(providerId, { models: catalogModels, etag, checkedAt: timestamp });
  await modelFile.delete(providerId); // no credential/model store.close().
  const ctx = defaultProviderAuthContext(); // S; env/fileExists themselves A.
  const envResult = await ctx.env("OPENAI_API_KEY");
  const fileExistsResult = await ctx.fileExists(authPath);
  const apiKey = envApiKeyAuth("Example key", ["EXAMPLE_API_KEY"]); // S definition.
  const lazy = lazyOAuth({ name: "Example OAuth", load: loadOAuth }); // S definition.
  const providerAuthResult = await resolveProviderAuth(
    { id: providerId, auth: providerAuth },
    file,
    ctx,
    { signal },
  );
  // auth/api-key/OAuth optional members aren't null; key credential can have env?.
  // nonfluent, no network from construction.
}

/**
 * Public ai/index.ts:51–75; auth/oauth/{anthropic,openai-codex,github-copilot}.
 */
async function currentOAuthOpeners() {
  const anthropic = anthropicOAuth;
  const codex = openaiCodexOAuth; // singleton objects.
  const copilot = githubCopilotOAuth(copilotOAuthOptions); // S factory, options optional.
  const loadedAnthropic = await loadAnthropicOAuth(); // A lazy module/flow loader.
  const loadedCodex = await loadOpenAICodexOAuth();
  const loginResult = await anthropic.login(authInteraction); // AuthInteraction owns signal/prompts.
  const loginResult2 = await codex.login(authInteraction);
  const loginResult3 = await copilot.login(authInteraction);
  const refreshResult = await anthropic.refresh(oauthCredential, signal);
  const toAuthResult = await codex.toAuth(oauthCredential); // credential-specific model auth.
  const generatePKCEResult = await generatePKCE(); // challenge/verifier; no receiver chaining.
  // getAccountId returns string|null (cannot extract account); HTML helpers return string S.
  const accountIdResult = getAccountId(accessToken);
  const oauthSuccessHtmlResult = oauthSuccessHtml({ provider: providerId });
  const oauthErrorHtmlResult = oauthErrorHtml(errorMessage);

  // registerBunOAuthFlows():V installs Bun OAuth callbacks; no disposer returned.
  registerBunOAuthFlows(); // only inside this uncalled demo, not top-level.
  // Device-code poll/abortableSleep family uses source option objects; bounded A.
  const pollOAuthDeviceCodeFlowResult = await pollOAuthDeviceCodeFlow(deviceCodePollOptions);
  await abortableSleep(delayMs, signal, "Login cancelled");
}

/**
 * Public ai/models.ts:119; api/lazy.ts:9,57; api/deferred.ts:12–40.
 */
async function currentProviderLowLevel(provider: Provider, model: Model<Api>) {
  const catalogModels = provider.getModels(); // S.
  if (provider.refreshModels !== undefined) await provider.refreshModels(refreshContext);
  if (provider.filterModels !== undefined) {
    const filterModelsResult = provider.filterModels(provider.getModels(), credential);
  }
  const stream = provider.streamSimple(model, transcriptContext, { signal });
  const result = await stream.result(); // Provider uses normalized TranscriptContext.
  const typed = provider.stream(model, transcriptContext, providerApiOptions);
  for await (const event of typed) {
    // Handle event here.
  }
  if (provider.fetchDeferred !== undefined) {
    const result2 = await provider
      .fetchDeferred(model, deferredHandle, deferredFetchOptions)
      .result();
  }
  if (provider.cancelDeferred !== undefined)
    await provider.cancelDeferred(model, deferredHandle, deferredCancelOptions);
  const deferredStream = lazyStream(model, setupStream); // S; setupStream A.
  const implementation = lazyApi(loadProviderStreams, deferredCapabilities); // S, not execution.

  const anthropicAccountLimitsResult = await fetchAnthropicAccountLimits(
    anthropicModel,
    anthropicOptions,
  );
  const openAICodexAccountLimitsResult = await fetchOpenAICodexAccountLimits(
    codexModel,
    codexOptions,
  );
  const compactOpenAICodexContextResult = await compactOpenAICodexContext(
    codexModel,
    context,
    codexOptions,
  );
  const compactOpenAIResponsesContextResult = await compactOpenAIResponsesContext(
    openaiModel,
    context,
    openaiOptions,
  );
  // Optional options ≠ null. Provider compaction is not durable sdk.runs.compact.
}

/**
 * Public ai/session-resources.ts:7,15,36; utils/event-stream.ts:101.
 */
async function currentModelResourceStreams() {
  const unregister = registerSessionResourceCleanup(cleanupSessionTransport); // S→D.
  const release = acquireSessionResources(resourceSessionId); // S→D reference count.
  release();
  release(); // idempotent last-release cleanup.
  cleanupSessionResources(resourceSessionId); // V; omitted sessionId means broader cleanup.
  unregister(); // does not serve as Models.close().
  const events = new EventStream(isCompleteEvent, extractFinalResult); // S generic stream.
  events.push(nonterminalEvent);
  events.end(finalResult);
  const result = await events.result();
  const assistantEvents = new AssistantMessageEventStream(); // S.
  const assistantFactory = createAssistantMessageEventStream(); // S.
  assistantFactory.push(assistantEvent);
  assistantFactory.end(assistantMessage);
  const result2 = await assistantFactory.result();
  // Iteration does not automatically cancel provider; pass signal to provider request.
  // FIFO queue and pure token/pricing/transcript/validation/retry utilities: export index.
}

/**
 * Public host/index.ts:96,120,131,136,154. A createHost, no fluent builder.
 */
async function currentHostOpeners() {
  const chat = await createHost({
    store,
    models,
    model,
    plugins: { kind: "chat", system: "Be concise" },
  });
  try {
    const createResult = await chat.sessions.create();
  } finally {
    await chat.close();
  }
  const custom = await createHost({
    store,
    models,
    model,
    plugins: { kind: "custom", plugins, cwd },
  });
  try {
    const availableModels = await custom.provider.models.list();
  } finally {
    await custom.close();
  }
  const workspaces = createWorkspaceStore(); // S→WorkspaceStore; no close.
  // Asks only for folders with project input (.nyte/plugins, .nyte/nyte.json,
  // .nyte|.agents|.claude/skills); a plain folder resolves trusted. Pi's
  // defaultProjectTrust rule. settings.json workspaceTrust is the
  // WorkspaceTrustMode; "always" bypasses, "never" runs without the input.
  const trusted = await workspaces.require(cwd); // branded value only from store; .projectInput says whether the folder's own plugins/skills load.
  const workspaceHost = await createHost({
    store,
    models,
    model,
    plugins: {
      kind: "workspace",
      target: workspacePluginTarget,
      extra: extraPlugins,
      sources,
      onFailure, // Source read failures, reported once per change; a set that cannot activate is a session diagnostic.
    },
    workspace: createWorkspaceBackend(workspaces),
    environments: environmentPlugins,
  });
  // The host watches the target's plugin directories itself (trust.changes); sessions reload
  // on change and before each response. Hosts never push a plugin set. TUI /reload is
  // sources.invalidate() + notifyPluginSources().
  try {
    const createResult2 = await workspaceHost.sessions.create();
  } finally {
    await workspaceHost.close();
  } // store/models still caller-owned; closing ends every source watch.
  const modelResult = await resolveModel(models, `${providerId}/${modelId}`);
  // Deferred target exact shape below; resolve must produce PluginTarget or blocked trust.
  const options = { kind: "deferred", cwd, resolve: resolveDeferredTarget };
  // Host forces drain all, auto local identity; no host.browser or host.terminal here.
}

/**
 * PUBLIC host/workspace-store.ts:131; catalog.ts:125,162,175,209.
 */
async function currentHostMachineStores() {
  const workspaces = new WorkspaceStore(workspacesPath, { limit: 50, mode: () => trustMode }); // S; mode: WorkspaceTrustMode, read per decision.
  const resolveResult = await workspaces.resolve(cwd); // trusted/unknown; not null. unknown = has project input, no grant.
  const trustResult = await workspaces.trust(cwd); // explicit durable trust grant.
  const requireResult = await workspaces.require(cwd);
  const workspacesList = await workspaces.list();
  await workspaces.touch(cwd, timestamp);
  await workspaces.forget(cwd);
  const preferences = new ModelPreferencesStore(preferencesPath); // S.
  const defaultPreferences = createModelPreferencesStore(); // S, no closer.
  const preferencesValue = await preferences.read();
  const preferencesUpdateOutcome = await preferences.update({
    kind: "provider",
    provider: providerId,
    enabled: true,
  });
  const preferencesUpdateOutcome2 = await preferences.update({
    kind: "models",
    provider: providerId,
    ids: [modelId],
    hidden: false,
  });
  const preferencesUpdateOutcome3 = await preferences.update({
    kind: "defaults",
    model: { provider: providerId, id: modelId },
    thinkingLevel: "medium",
    fast: false,
  });
  const modelCatalogResult = createModelCatalog(models, preferences); // S catalog view; not mutable providers.
  const catalogResult = await readCatalog(models, defaultPreferences);
  const settings = new HostSettingsStore(settingsPath()); // S; default path optional.
  const unsubscribe = settings.subscribe((settings) => {
    // Apply the updated settings here.
    void settings;
  }); // S→D.
  const settingsValue = settings.current();
  const settingsValue2 = await settings.read(); // current() is getter FUNCTION.
  const settingsSetOutcome = await settings.set(hostSettingsPatch);
  unsubscribe();
  const settingsFileSyncResult = readSettingsFileSync();
  const settingsFileResult = await readSettingsFile();
  const updateSettingsFileResult = await updateSettingsFile(settingsPath(), updateSettingsObject);
  const compactionSettingsResult = compactionSettings(settings.current());
  const cacheWarmingModeResult = cacheWarmingMode(settings.current().cacheWarming);
  // terminalShell:null chooses login shell, traceEndpoint:null disables export; other options aren't null.
}

/**
 * PUBLIC host/environment.ts:27,41,77; github.ts:680; otel.ts:28.
 */
async function currentHostMachineServices() {
  const providers = createProviderEnvironment({
    catalog: readProviderCatalog,
    setPreference,
    usage: readUsage,
    accountLimits: readAccountLimits,
    login: loginProvider,
    refresh: refreshProvider,
    logout: logoutProvider,
  }); // S→service.
  const github = createGitHubService({ beforeCommand, run: runGitHubCommand }); // S.
  try {
    const scoped = providers.owned(signal); // S; shared service, owned attempts only.
    const githubScoped = github.owned(signal); // S; doesn't cancel joined calls.
    // their machine operation tables used below.
    for await (const state of providers.follow(attemptId)) {
      // Handle state here.
    } // I ends terminal.
    const githubValue = await github.state();
    const signInResult = await github.signIn();
    const signOutResult = await github.signOut();
    const pullRequestResult = await github.createPullRequest(pullRequestInput, workspaceContext);
  } finally {
    try {
      github.close();
    } finally {
      await providers.close();
    }
  }
  const otel = createOtelExport({ serviceName: "sdk-spec", endpoint: otelEndpoint });
  try {
    const telemetry = otel.telemetry;
  } finally {
    await otel.shutdown();
  } // After SDK settlement; not global registration.
}

/**
 * PUBLIC host/usage.ts:740,975; store-usage.ts:367; usage-scan.ts:23.
 */
async function currentHostUsage() {
  const caches = createUsageScanCaches(); // S; reuse across scans, no closer.
  const claudeCodeUsageResult = await readClaudeCodeUsage({
    models,
    signal,
    cache: caches.claudeCode,
  });
  const codexUsageResult = await readCodexUsage({ models, signal, cache: caches.codex });
  const localUsageResult = await readLocalUsage({ models, signal, caches });
  const accountUsageResult = await readAccountUsage({ models, provider: "anthropic", signal });
  const accountUsageResult2 = await readAccountUsage({ models, provider: "openai-codex", signal });
  const observedAccountUsageResult = observedAccountUsage(models, "anthropic"); // S AccountUsage|undefined.
  const scanner = new UsageScanner(home); // S, scan A.
  try {
    const scanResult = await scanner.scan({ stores: storeLocations, catalog: models.getModels() });
  } finally {
    await scanner.close();
  }
  const worker = new UsageScanWorker(home, usageWorkerEntry); // S, spawn on scan.
  try {
    const scanResult2 = await worker.scan({ stores: storeLocations, catalog: models.getModels() });
  } finally {
    await worker.close();
  } // A worker termination; independent SDK owner.
  // Local-history signal/caches are optional, never null.
  // readAccountUsage REQUIRES signal: AbortSignal; it is not an optional field.
}

/**
 * PUBLIC host/plugins.ts:215–282; sources.ts:42; watch.ts:25,194.
 */
async function currentHostPluginSources() {
  const watcher = createSourceWatcher(onSourcesChanged); // S→{add A,wait A,dispose V}.
  const prepare = nodePluginLoader(hostModules); // S loader; process-wide Node hooks.
  const sources = createPluginSources(prepare, watcher.wait); // S; not yet loaded.
  try {
    const loaded = await sources.read(pluginEntry); // A→{version,value}; not null.
    sources.retain(new Set([pluginEntry])); // V cache pruning, NOT release function.
    sources.invalidate(); // V; next read revalidates.
    await watcher.add(pluginEntry);
    await watcher.wait(missingPluginEntry);
    const discoverPluginUnitsResult = await discoverPluginUnits(pluginRoots);
    const unitDataFilesResult = await unitDataFiles(pluginDirectory);
    const manifestResult = await readManifest(pluginTarget);
    const pluginsResult = await resolvePlugins({
      builtins,
      directories: pluginRoots,
      sources,
      manifest,
    });
    const hostPluginsResult = await resolveHostPlugins(pluginTarget, {
      models,
      model,
      env,
      sources,
      extra: plugins,
    });
    const stopDirectories = watchPluginDirectories(watchOptions); // S→D; createHost wires this behind trust.changes, a custom host does so itself.
    notifyPluginSources(); // S; fires every directory watch, as the TUI's /reload does.
    stopDirectories();
    const samePluginSourcesResult = samePluginSources(previousPlugins, nextPlugins);
    const sourced = withPluginSource(plugin, { source: "builtin", version: "demo" }); // S same object.
    const pluginSourceResult = pluginSource(sourced); // metadata|undefined, no null/no runtime open.
  } finally {
    sources.dispose();
    watcher.dispose();
  } // two separate V owners.
  // host default resolver's process-global MCP pool has no public returned closer.
}

/**
 * PUBLIC core/plugins/types.ts:41,287,338; definition S returns same object.
 */
function currentPluginDefinition() {
  return definePlugin({
    id: "sdk-spec",
    async session(api) {
      const setting = api.settings.add("demo-choice", {
        label: "Mode",
        default: "on",
        choices: [
          { id: "on", label: "On" },
          { id: "off", label: "Off" },
        ],
      }); // S→Setting, NOT D.
      const settingValue = await setting.get();
      await setting.set("off");
      const stopSetting = setting.subscribe((value) => {
        // Handle this update here.
        void value;
      }); // S→D; choices typed, no null.
      const stopTool = api.tools.add("demo", toolDefinition); // S→D, stamps name.
      const stopDraft = api.tools.add((draft) => {
        draft.set(agentTool.name, agentTool);
        const hasResult = draft.has(agentTool.name);
        const draftValue = draft.get(agentTool.name);
        const idsResult = draft.ids();
        draft.update(agentTool.name, updateTool);
        draft.wrap(agentTool.name, wrapExecute);
        draft.delete(unwantedToolName);
      }); // synchronous contributions, no I/O.
      const toolsList = api.tools.list();
      const agentsList = api.agents.list();
      api.agents.add("reader", { tools: ["read"], system: "Read only", steps: 5 });
      api.prompt.add("context", { text: "<context>demo</context>", order: 10 });
      api.commands.add("demo", { description: "Demo", run: () => ({ prompt: "Explain" }) });
      api.resources.add(skillId, skill);
      api.status.add("demo", { text: "Ready", order: 100 });
      api.modelContext.add(modelReference, { contextWindow: 100_000, compactAt: 80_000 });
      const stopWrap = api.wrapEnv(wrapEnvOps); // S→D; cannot change id/cwd.
      const stopHook = api.hook("before_tool", beforeToolPolicy); // fail closed.
      const stopEvent = api.events.subscribe("run_ended", (value) => {
        // Handle this update here.
        void value;
      }); // observation only.
      const infoResult = await api.session.info();
      const contextResult = await api.session.context();
      await api.session.rename("Demo");
      const storageValue = await api.storage.get("fact");
      await api.storage.set("fact", null); // JsonValue null valid.
      api.diagnostics.warn("Demo warning");
      api.diagnostics.notify({ message: "Done", sound: false });
      api.refresh();
      api.defer(resourceChange); // V, not await-first.
      const env = api.env;
      const signal = api.signal; // signal aborts on deactivation; setup returns no cleanup.
      stopSetting();
      stopTool();
      stopDraft();
      stopWrap();
      stopHook();
      stopEvent();
    },
  }); // Other registration disposers are tracked automatically by scope.
}

/**
 * PUBLIC core/plugins: tools/env.ts:91,102; loop/env.ts:1.
 */
async function currentExecutionEnv() {
  const local = createLocalExecutionEnv({ id: environmentIdentity, cwd }); // S.
  const provider = localEnvironmentPlugin({ id: environmentIdentity }); // S Plugin.
  const opened = await provider.environment.open({ kind: "local", id: environmentIdentity, cwd }); // A.
  const resolveResult = local.resolve("src", "index.ts");
  const statResult = await local.stat(filePath); // missing stat→undefined.
  const realpathResult = await local.realpath(filePath); // string|undefined, NOT null.
  const fileResult = await local.readFile(filePath);
  const readdirResult = await local.readdir(cwd); // Buffer / string[].
  await local.mkdir(scratchDirectory);
  await local.writeFile(scratchFile, "demo");
  const execResult = await local.exec("printf demo", {
    onData: (chunk) => {
      /* Consume process output here. */ void chunk;
    },
    signal,
    timeout: 10,
  });
  // timeout seconds optional; onData required. No interactive PTY or env.close().
  // identical id/cwd required; tool calls use call.env.
}

/**
 * PUBLIC loop/types.ts:246,295,384; tools/bind-tool.ts:24.
 */
async function currentToolEscape(call: ToolContext) {
  const bound = bindTool(agentTool); // S schema parser for execute/present/images.
  // no receiver chain; prepareArguments is compatibility escape.
  if (call.run !== undefined) {
    const toolsList = call.run.tools.list(); // S, policy-routed catalog.
    const executeResult = await call.run.tools.execute(toolName, args, {
      signal: call.signal,
      onUpdate,
    });
    const activateResult = call.run.tools.activate(deferredToolNames); // activates current run capability.
    const historyResult = await call.run.history();
    const id = call.run.id;
    const head = call.run.head;
  } // User job calls may lack run; no unchecked access.
  // throw new ToolWait({selection}) or {until}: persisted generation, NOT JS continuation.
  // ToolWake(wait,context) returns settlement or {kind:"wait",selection?/until?}.
  // Optional reply/signal args are not null except JsonValue replies themselves.
  const toolWaitValue = new ToolWait({ selection: selection });
  const toolWaitValue2 = new ToolWait({ until: deadline });
  const toolErrorValue = new ToolError(toolErrorResult, toolErrorReason); // result first, reason optional.
}

/**
 * PUBLIC core/plugins/index.ts:13–22; plugin export subpaths; all definitions S.
 */
async function currentAllPluginFactories() {
  const skills = await loadSkills(skillDirectories(pluginTarget)); // A discovery.
  const builtins = [
    systemPromptPlugin(),
    systemPromptPlugin("Custom system"),
    toolsFsPlugin(),
    skillsPlugin(skills),
  ];
  const overrides = providerPlugin({ id: "example-override", provider, enabled: true });
  const providerResult = await overrides.provider(sessionApi); // A Provider|undefined; disabled is undefined.
  const examples = [
    bashDescriptionPlugin,
    questionPlugin,
    notificationsPlugin,
    fastModePlugin({ models, defaultModel: model }),
    renamePlugin({ models, model }),
    openaiCompactionPlugin({ models }),
    openaiAstraContextPlugin(),
  ];
  // First three examples are singleton values, NOT callable factories.
  const terminal = define({ id: "terminal-only", setup: setupTerminalPlugin }); // S identity.
  // terminal Definition.setup returns Cleanup|void|Promise<Cleanup|void>; NOT core Plugin.
  // Terminal Context renderer/theme/ui slot are adapter-only, not universal SDK semantics.
  const invocationText = formatSkillInvocation(skill);
  // Optional system text/enabled are not null; no definition.close methods.
}

/**
 * PUBLIC plugin/src/mcp.ts:45,160,207,217,840.
 */
async function currentMcpConnectors() {
  const servers = new McpServers(); // S process pool, caller owns close A.
  const config = {
    stdio: { command: commandPath, args: commandArgs, env: commandEnv, cwd },
    http: { url: mcpUrl, headers: mcpHeaders },
  }; // EXACT two transport shapes.
  const stdio = servers.acquire("stdio", config.stdio, cwd); // S→handle.
  const http = servers.acquire("http", config.http, cwd); // Stdio vs StreamableHttp.
  try {
    const unsubscribe = http.subscribe((status) => {
      // Update the connection status here.
      void status;
    }); // S→D.
    await stdio.ready();
    await http.ready(); // A→void, never rejects; check status.
    const status = stdio.status;
    const status2 = http.status; // connecting/connected/tools/instructions/failed/error.
    unsubscribe();
    servers.reconnectFailed(); // V; no fluent reconnect chain.
    const mcpPluginResult = mcpPlugin({ servers, config }); // S definition borrows pool.
    const connectionKeyResult = connectionKey("http", config.http, cwd);
    const mcpConfigVersionResult = mcpConfigVersion(config);
  } finally {
    stdio.release();
    http.release();
    await servers.close();
  }
  // Optional disabled/exposure/toolExposure/description, stdio args/env/cwd, HTTP headers.
  // These are omitted options, NOT null. Last handle release lingers, not immediate pool shutdown.
}

/**
 * PUBLIC plugin/src/codemode.ts:24; codemode-runtime.ts:3,6; worker entry.
 */
function currentCodemodeConnectors() {
  const defaultPlugin = codemodePlugin(); // S, options omitted.
  const customPlugin = codemodePlugin({ workerUrl: codemodeWorkerEntry, wasm: quickJSWasm });
  const path = resolveQuickJSWasmPath(); // S string; Node resolution only when invoked.
  // loader export; supplied loader options.
  // codemode-worker is executable worker entry, not codemodeWorker() factory.
  // Per-call sandbox close is INTERNAL codemode-execute.ts:235; not plugin.close().
  // Exposes codemode replay never + tool_search replay safe; execution nested policy remains.
  // workerUrl/wasm optional ≠ null. Store updates survive successful code only.
}

/**
 * PUBLIC examples/web-search/index.ts:102,107,180,497–527; provider.ts:147.
 */
async function currentSearchConnectors() {
  const options = {
    credentials: searchCredentials,
    fetch: searchFetch,
    environment: readEnv,
    random,
  };
  const webSearchPluginResult = webSearchPlugin();
  const webSearchPluginResult2 = webSearchPlugin(options);
  const webSearchPluginsResult = webSearchPlugins(options); // S Plugin/Plugin[].
  const providers = [exaProvider, firecrawlProvider, parallelProvider, tavilyProvider]; // objects.
  const result = [exaPlugin, firecrawlPlugin, parallelPlugin, tavilyPlugin]; // singleton setting plugins.
  for (const provider of providers) {
    const webSearchProviderPluginResult = webSearchProviderPlugin(provider);
    const webSearchCredentialIdResult = webSearchCredentialId(provider.id);
    const executeResult = await provider.execute({
      query: "Nyte SDK",
      key: searchKey,
      fetch: searchFetch,
      signal,
    });
  }
  // key optional; credentials.write(provider,undefined) clears key; not null reset.
  // Exa/Firecrawl/Parallel stateless MCP; Tavily JSON API; NOT McpServers ownership.
  // No Grok. Default module export is instantiated webSearchPlugin(), not a new factory.
}

/**
 * PUBLIC client/index.ts:129,146; server/index.ts:105,426.
 */
async function currentClientServerOpeners() {
  const client = createNyteClient({
    baseUrl: address,
    token,
    headers,
    fetch: injectedFetch,
    maxFrameChars: frameLimit,
  });
  const infoResult = await client.info(); // A→ServerInfo, client itself S.
  // client namespace calls match RemoteNyte, see coverage index; watch/observer/outbox: surfaces.
  const server = createNyteServer({
    sdk,
    version: "spec",
    auth: { kind: "token", token },
    environment,
    describe: describeHost,
    browserOrigins: allowedOrigins,
    onError,
  });
  try {
    const fetchResult = await server.fetch(request);
  } finally {
    server.close();
  } // fetch A, close V; not SDK close.
  const policyServer = createNyteServer({
    sdk,
    version: "spec",
    auth: { kind: "custom", authorize },
    permissions,
    maxBodyBytes: 8_388_608,
    heartbeatMs: 15_000,
  });
  policyServer.close(); // supplied permission table default-denies; literal true grants.
  // Token >=16; no null options; create client/server S, NOT await-first builders.
  // No client.close; no server.attach; no transport implicit ownership of SDK/store.
}

/**
 * PUBLIC protocol/environment.ts:665; client/index.ts:146; operation names exact.
 */
async function currentMachineEnvironment(client: NyteClient) {
  const catalog = await client.environment("environment.catalog", undefined);
  const updatedCatalog = await client.environment("environment.setPreference", {
    kind: "provider",
    provider: providerId,
    enabled: true,
  });
  const usage = await client.environment("environment.usage", { sinceDay: null, untilDay }); // null is intentional unbounded start.
  const accountLimits = await client.environment("environment.accountLimits", undefined);
  const loginAttempt = await client.environment("environment.login", {
    provider: providerId,
    method: { kind: "browser" },
    attempt: attemptId,
  });
  const loginAttempt2 = await client.environment("environment.login", {
    provider: providerId,
    method: { kind: "api_key", key: secretKey },
    attempt: anotherAttempt,
  });
  const loginState = await client.environment("environment.loginAttempt", { attempt: attemptId });
  const loginAnswer = await client.environment("environment.answerLogin", {
    attempt: attemptId,
    code,
  });
  const loginCancellation = await client.environment("environment.cancelLogin", {
    attempt: attemptId,
  });
  const logoutResult = await client.environment("environment.logout", { provider: providerId });
  const githubState = await client.environment("environment.github.state", undefined);
  const githubSignIn = await client.environment("environment.github.signIn", undefined);
  const githubSignOut = await client.environment("environment.github.signOut", undefined);
  const pullRequest = await client.environment("environment.github.createPullRequest", {
    title,
    body,
    draft: true,
  });
  // All A, nonfluent. Optional host capability, absent on CF runtime; not ExecutionEnv.
}

/**
 * PUBLIC server/node.ts:147,166; serve/index.ts:27,35,40,84.
 */
async function currentNodeServeOpeners() {
  const listener = requestListener(fetchHandler, { origin, onError }); // S adapter, not listening.
  const serving = await serve({
    sdk,
    version: "spec",
    auth: { kind: "token", token },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const address = serving.address;
    serving.disconnectClients();
  } finally {
    await serving.close();
  } // Listener only; SDK/store separately owned.
  const app = await startServe({
    sdk,
    version: "spec",
    auth: { kind: "token", token },
    attach: attachSession,
    appRoot,
  });
  try {
    const pairingUrlResult = pairingUrl(appOrigin, app.address, token);
    const pairingOriginResult = pairingOrigin(app.address, appRoot);
    const appDistRootResult = appDistRoot();
    app.disconnectClients();
  } finally {
    await app.close();
  }
  const randomTokenResult = randomToken();
  const orCreateTokenResult = await loadOrCreateToken(); // helper S token vs A persistence.
  const findTailnetAddressResult = await findTailnetAddress(platform, commandRunner);
  // hostname/port/handle optional; NOT old host/token fields; no null options.
  // INTERNAL serve/host.ts:90,233: openServedHost, not root export.
  const owned = await openServedHost({ cwd, onDiagnostic, models, runGitHubCommand });
  try {
    owned.attach(id);
    const sdk2 = owned.sdk;
    const environment = owned.environment;
    const workspace = owned.workspace;
  } finally {
    await owned.close();
  } // Scanner close missing from this implementation.
}

/**
 * PUBLIC cloudflare/sqlite.ts:19; routing.ts:5; index.ts:8; agents.ts:5,51.
 */
async function currentCloudflareOpeners() {
  const connection = durableSqlite(durableStorage); // S; platform-owned, no closer.
  const routed = await routeNyteRequest({
    request,
    namespace: doNamespace,
    authorize: authorizeTenant,
    prefix: "/api",
  });
  const routeNyteAgentRequestResult = await routeNyteAgentRequest({
    request,
    namespace: agentNamespace,
    authorize: authorizeTenant,
  });
  // Class subclass declarations stay inside an uncalled function; no platform creation now.
  class ExampleDurableObject extends NyteDurableObject {
    protected configure() {
      return cloudflareOptions;
    } // CloudflareOptions or Promise.
  }
  class ExampleAgent extends NyteAgent {
    protected configureNyte() {
      return cloudflareOptions;
    }
  }

  // Options nyte omits store/workspace/trust; server omits sdk/environment/describe.
  // Required onAlarmError; maxHeads/budgetMs optional, no null. No public close.
  // INTERNAL runtime.ts:17; alarm.ts:27; scan.ts: SQL keyset repair.
  const runtime = await openCloudflareRuntime({
    storage: durableStorage,
    options: cloudflareOptions,
    arm,
  });
  const fetchResult = await runtime.fetch(request);
  await runtime.driver.wake();
  await runtime.driver.alarm();
  const submitResult = await runtime.driver.submit(admit); // A; durable arm BEFORE admission.
  const driver = createAlarmDriver({
    scan,
    advance,
    arm,
    now,
    maxHeads: 32,
    budgetMs: 10_000,
    onError,
  });
  await driver.wake();
  await driver.alarm();
  const submitResult2 = await driver.submit(admit);
  // No attach loop/no workspace backend/no machine Environment; DO/Agent platform owns lifetime.
}

/**
 * PUBLIC vercel/index.ts:9,25; admission.ts:4; workflow.ts:4; postgres.ts:7.
 */
async function currentVercelOpeners() {
  const advanceNyteResult = await advanceNyte({
    input: { sessionId: id, head: "main", signal },
    openExecution,
  });
  const wake = createVercelDispatcher({ workflow: workflowFunction, startWorkflow, openExecution }); // S→function.
  await wake({ sessionId: id });
  await wake({ sessionId: id, head: "main" }); // omit→all heads.
  const execution = await openPostgresExecution({ pool: poolConfig, createSdk, onPoolError }); // A owns pool.
  try {
    const admitted = withDispatch({ sdk: execution, wake, outbox: execution.outbox }); // S façade, same data API.
    const receipt = await admitted.messages.send({
      sessionId: id,
      content: "Durable wake",
      delivery: "next",
      key: admissionKey,
    });
    // Also wraps configure/redeliver/reply/abort; NOT every internal plugin wake.
  } finally {
    await execution.close();
  } // A SDK then owned store/pool even on error.
  await driveNyte({ advance: advanceOne, wait: workflowSleep }); // A workflow driver.
  // Waiting without deadline returns; dated waits/retries/busy sleep; no long-lived attach.
  // PUBLIC outbox.ts:27,90; borrowed db, NO outbox.close.
  const outbox = dispatchOutbox(postgresDb); // S, NOT client optimistic outbox.
  await outbox.initialize();
  const obligation = await outbox.record({ sessionId: id });
  const claimResult = await outbox.claim(60_000, 100);
  await outbox.settle(obligation);
  const reconcileDispatchResult = await reconcileDispatch({
    outbox,
    wake,
    graceMs: 60_000,
    limit: 100,
  });
  // settleAfterMs optional: omit preserves recovered rows; require proven bound before setting.
  const vercelSandboxPluginResult = vercelSandboxPlugin({ connect: connectSandbox }); // S environment provider.
  // sandbox.ts:61: lazy A connect(Workspace), caller owns actual create/connect/stop/billing.
  // No Sandbox.create export; no sandbox stop by Nyte.close; no null options/fluent chains.
}

/**
 * PUBLIC connect/client.ts:43,55,182; enrollment.ts:15,49,112; encoding.ts:93.
 */
async function currentConnectEnrollment() {
  const broker = createBrokerClient({
    origin: connectOrigin,
    sessionToken: freshClerkToken,
    fetch: connectFetch,
  });
  const listEnvironmentsResult = await broker.listEnvironments({ signal }); // input REQUIRED; signal optional.
  const secret = await createDeviceSecret(deviceCrypto); // A {token,digest}; hashes TOKEN UTF-8.
  const enrolled = await broker.enroll({
    environmentId,
    request: { clientId, clientName, digest: secret.digest },
    signal,
  });
  const connection = { url: relayAddress(connectOrigin, environmentId), token: secret.token };
  try {
    const awaitAcceptanceResult = await awaitAcceptance({
      connection,
      fetch: connectFetch,
      signal,
      readiness: READINESS,
    });
    const sdkClient = createNyteClient({
      baseUrl: connection.url,
      token: connection.token,
      fetch: connectFetch,
    });
    const infoResult = await sdkClient.info(); // enrollment/readiness itself does NOT open socket.
  } finally {
    const releaseOnHostResult = await releaseOnHost({
      connection,
      fetch: connectFetch,
      timeoutMs: RELEASE_TIMEOUT_MS,
    });
  }
  await broker.revokeDevice({ environmentId, deviceId, signal }); // strong Clerk session revoke.
  await broker.removeEnvironment({ environmentId, signal }); // destructive owner operation.
  const accountConfig = parseAccountConfig({ publishableKey, origin: connectOrigin }); // S config|undefined.
  // publishableKey/origin fields required but may be undefined; missing disables account.
  // sessionToken returns Promise<string|null>: null explicitly signed out. No broker.close.
}

/**
 * PUBLIC connect/signing.ts:54–228; relay.ts:218–338, schemas/encoding exports.
 */
async function currentConnectSigningRelay() {
  const key = await generateMachineKey();
  const publicKey = publicKeyOf(key); // A key / S public.
  const publicKeys = publicKeySet(brokerSigningKeysWithKid);
  const keyThumbprintResult = await keyThumbprint(publicKey);
  const sha256Result = await sha256(body);
  const randomIdResult = randomId();
  const nowSecondsResult = nowSeconds(); // S IDs/time; no I/O at top level.
  const proof = await createProof({ key, issuer, audience, method: "POST", path, body });
  const verifyProofResult = await verifyProof({
    token: proof,
    key: publicKey,
    issuer,
    audience,
    method: "POST",
    path,
    body,
  });
  const token = await signClaims({ key, typ: tokenType, claims });
  const verifyClaimsResult = await verifyClaims({
    token,
    key: publicKey,
    typ: tokenType,
    issuer,
    audience,
    schema: claimsSchema,
    lifetime,
  });
  const tokenKeyIdResult = tokenKeyId(token);
  const brokerKeyResult = brokerKey(brokerKeys, token); // undefined unknown key, NOT null.
  const relayFrameResult = parseRelayFrame(frame);
  const desktopFrameResult = parseDesktopFrame(frame); // S parsed|undefined.
  const encodeChunksResult = encodeChunks(bytes);
  const decodeChunkResult = decodeChunk(encodedChunk);
  const relayRequestHeadersResult = relayRequestHeaders(headers);
  const relayResponseHeadersResult = relayResponseHeaders(headers);
  const hasNullBodyResult = hasNullBody(status);
  const publicRelayTargetResult = publicRelayTarget(url);
  const relayRefusalResult = relayRefusal(refusalCode); // S routing/response, NOT socket.
  // now optional ms, lifetime required seconds; no fluent chains. Record proof jti separately.
  // PUBLIC connect has NO WebSocket/relay socket opener; actual desktop connector: other packet.
}

/**
 * INTERNAL connect-worker/index.ts; broker.ts:125; context.ts:32; relay-object.ts:94.
 */
async function currentConnectWorkerDeployment() {
  const broker = createBroker({ fetch: brokerFetch, now, log }); // S→fetch/scheduled handlers.
  const fetchResult = await broker.fetch(request, workerEnv, executionContext);
  // Scheduled handler arguments supplied exactly from Worker implementation, not SDK options.
  await broker.scheduled(scheduledController, workerEnv, executionContext);
  const context = createContext({ env: workerEnv, dependencies: brokerDependencies, waitUntil });
  if (context !== undefined) await sweep(context); // INTERNAL cron.ts:14, bounded security cleanup.
  // platform DO ctor(ctx,env), fetch/alarm/WebSocket callbacks.
  // DB,RELAY,CONNECT_ORIGIN,CONNECT_WEB_ORIGINS,CLERK_ISSUER,CLERK_AUTHORIZED_PARTIES,
  // CLERK_JWT_KEY,CLERK_SECRET_KEY,CLERK_WEBHOOK_SIGNING_SECRET,BROKER_SIGNING_KEYS.
  // No exports map/public SDK opener; platform owns DO/socket lifecycle. No broker.close.
  // Latest desktop socket replaces old; in-memory requests don't survive all hibernation.
}

/**
 * INTERNAL kernel/queue.ts:117,191,199,296,310,328,382,523.
 */
async function currentKernelQueue(session: Session) {
  const admitted = await submit(session, {
    head: "main",
    body: changeBody,
    kind: changeKind,
    delivery: "next",
    key: admissionKey,
    preparation: { kind: "none" },
  });
  const prepared = await submit(session, {
    head: "main",
    body: changeBody,
    kind: changeKind,
    delivery: "steer",
    preparation: { kind: "prepared", publish: publishChange, abandon: abandonChange },
  });
  // preparation REQUIRED; publish/abandon A; cross-session metadata precedes publication.
  const listDeliveriesResult = await listDeliveries(session, "main");
  const pendingInResult = await pendingIn(session, { head: "main", delivery: "steer" });
  const pendingResult = await pending(session, "main"); // returns PendingChange[]; not SDK PendingItem[].
  const nextToLandResult = await nextToLand(session, {
    head: "main",
    deliveries: ["steer", "next"],
  });
  const redeliverResult = await redeliver(session, {
    head: "main",
    change: changeOid,
    delivery: "next",
    before: null,
    actor,
  });
  const operationCancelOutcome = await cancel(session, { head: "main", change: changeOid, actor });
  // All A/nonfluent; before omitted keep / null end / OID before, no other null options.
}

/**
 * INTERNAL kernel/admission.ts:44,52,168,178,194,241,254, pure policy + store auth.
 */
async function currentKernelAdmission(session: Session) {
  const changes = await pending(session, "main");
  const head = headFor(run); // S; run can be undefined, not null.
  const batch = nextBatch(changes, "one"); // S through first user; all means whole batch.
  const boundaryBatchResult = boundaryBatch(changes, "all", awaitingAnswer); // S answer/report prefix while owed.
  const lead = await leadFor(session, batch); // A checks delegate continuation authority.
  const decideResult = decide(head, lead, agentChanged(run, batch)); // S wait/join/handoff/settle/start.
  const landsNowResult = await landsNow(session, run, changes, "one"); // A readiness; no lease acquisition.
  // Passive/report cannot start idle inference; later user input is not hidden by passive lead.
  // Decisions don't mutate refs, and are not chainable executable commands.
}

/**
 * INTERNAL kernel/effects.ts:145,155,165,216,228,262,296,360,391,398,422.
 */
async function currentKernelEffects(session: Session) {
  const opened = await openEffect(session, {
    lease,
    runId,
    callId,
    tool: toolName,
    args: effectArgs,
    replay: "safe",
    environment: environmentIdentity,
  });
  if (opened.kind !== "opened" && opened.kind !== "exists") return opened;
  const view = opened.view;
  const decideRecoveryResult = decideRecovery(view, environmentIdentity); // S replay decision.
  const parked = await parkEffect(session, { lease, view, selection, until: deadline });
  if (parked.kind === "parked") {
    const signalEffectResult = await signalEffect(session, {
      runId,
      callId,
      waitId: parked.view.oid,
      signal: effectSignal,
      actor,
    });
    // waitId optional internally, REQUIRED in public runs.reply; omit is explicit weaker escape.
    const expireEffectResult = await expireEffect(session, {
      lease,
      view: parked.view,
      now: deadline,
    });
  }
  const current = await readEffect(session, { runId, callId }); // view|undefined, NOT null.
  if (current !== undefined) {
    const settleEffectResult = await settleEffect(session, {
      lease,
      view: current,
      result: effectResult,
      settlement,
    });
  }
  const views = await listEffects(session, runId);
  const waitingBatchReadyResult = waitingBatchReady(views); // S readiness.
  const clearEffectsResult = await clearEffects(session, { lease, runId, views });
  // Alternative BEFORE acting: withdrawEffect(session,{lease,view}); never withdraw acted intent.
  const withdrawEffectResult = await withdrawEffect(session, { lease, view: freshUnactedView });
  // All writes A/fenced except participant signal; optional selection/until/actor ≠ null.
}

/**
 * INTERNAL kernel/stacks.ts:114,140,200,239,281,294,338; graph.ts:98.
 */
async function currentKernelStacksStep(session: Session) {
  const listHeadsResult = await listHeads(session);
  const headResult = await createHead(session, { head: "child", from: { head: "main" }, actor });
  // Negative escape: from.commit:null is type-accepted but rejects without stack parent.
  try {
    await createHead(session, { head: "unborn-child", from: { commit: null }, actor });
  } catch (cause) {} // TypeError: an unborn head requires a stack parent.
  const stackStatusResult = await stackStatus(session, "child");
  const advanceBaseResult = await advanceBase(session, { head: "child" });
  const moveHeadResult = await moveHead(session, {
    head: "child",
    to: targetOid,
    expect: previousOid,
    actor,
  });
  const fastForwardResult = await fastForward(session, { head: "child", actor });
  const deleteHeadResult = await deleteHead(session, { head: "child", actor });
  // Internal nullable from.commit differs from public heads.create. advanceBase is NOT rebase.
  // INTERNAL kernel/turn.ts:232,250; step.ts:41,59,1170,1229.
  const turn = bindTurn({ streamFn, model, sections: promptSections, tools: executableTools, env }); // S.
  const stepResult = await step(session, turn, {
    head: "main",
    drain: "one",
    lease,
    signal,
    beforeStep,
  });
  const driveResult = await drive(session, turn, {
    head: "main",
    drain: "all",
    signal,
    ttlMs: 30_000,
  });
  // Step can borrow lease; drive owns renewable lease. Prepare publishes declarations first.
  // Optional lease/steps/tree/resolveConfig/retry/compaction fields ≠ null; nonchainable outcomes.
}

/**
 * INTERNAL compaction.ts:898,1094,115,168,178,1201,1220,1448,1490; gc.ts:83,116.
 */
async function currentKernelCompactionGc(session: Session) {
  const commits = await contextCommits(session.objects, tip); // PUBLIC /store graph.ts:80 A.
  const prepareCheckpointResult = prepareCheckpoint(commits, compactionSettingsValue, {
    previousSummary,
  }); // S Result, NOT Promise.
  const summarizeCheckpointResult = await summarizeCheckpoint({
    commits,
    streamFn,
    model,
    settings: compactionSettingsValue,
    reason: compactionReason,
    signal,
  });
  const activeCompactionResult = await activeCompaction(session, "main");
  const startCompactionResult = await startCompaction(session, {
    head: "main",
    lease,
    reason: compactionReason,
  });
  const compactionClearUpdatesResult = await compactionClearUpdates(session, "main");
  const finishCompactionResult = await finishCompaction(session, { head: "main", lease });
  const writeCheckpointResult = await writeCheckpoint(session, {
    head: "main",
    streamFn,
    model,
    settings: compactionSettingsValue,
    reason: compactionReason,
    signal,
  });
  await retainCompactionUsage(session, { parent: tip, usage }); // loose spend, NOT head publication.
  const summarizeBranchResult = await summarizeBranch({
    abandoned,
    streamFn,
    model,
    customInstructions: "Keep decisions",
    signal,
  });
  const summaryCommitResult = summaryCommit({
    parent: null,
    body: summaryBody,
    imports: abandonedOids,
  }); // S; explicit null parent.
  for await (const entry of history(session.objects, tip, { limit: 100 })) {
    // Handle entry here.
  } // PUBLIC I.
  const branchResult = await branch(session.objects, tip); // PUBLIC full branch oldest-first A.
  const trimStreamResult = await trimStream(session, { keepAfterSeq: sequence }); // A floor; trim before collect.
  const collectResult = await collect(session, { graceMs: 60_000, now: timestamp }); // A scanned/reachable/swept.
  // Raw underlying destructive operations, isolated demo store ONLY:
  await session.events.trim(sequence);
  const objectsDeleteOutcome = await session.objects.delete(provenUnreachableOids);
  // No public sdk.gc or remote GC. Retained abandoned commits aren't eternal audit records.
  // INTERNAL kernel/outbox.ts:22 is event buffering, NOT client/Vercel outbox:
  const buffered = kernelEventOutboxFactory(session, { lease, onFenced }); // schematic binding to createOutbox.
  await buffered.emit(eventBody);
  await buffered.flush(); // emit Promise<void>|void, flush Promise<void>.
}

/**
 * PUBLIC core/dispatch.ts:78, host/{workspace-backend,git,tree-snapshot}.ts.
 */
async function currentCompositionSeams() {
  const dispatchResult = await dispatch(sdk, "messages.send", {
    sessionId: id,
    content: "Dispatch",
    delivery: "next",
  });
  const workspaceBackendResult = createWorkspaceBackend(workspaces);
  const gitVcsResult = createGitVcs(gitOptions);
  const treeSnapshotResult = createTreeSnapshot(treeSnapshotOptions);
  // S factories; workbench demos below owns full file/VCS/tree demos, not duplicated here.
  const files = await loadProjectContextFiles(contextFileOptions); // core context-files.ts:162 A.
  const formatContextFilesForPromptResult = formatContextFilesForPrompt(files); // S text, no receiver chaining.
  const identity = await environmentId(); // host/environment-id.ts:27 A, stable installation identity.

  const parser = createSseParser({ maxFrameChars: frameLimit }); // protocol/sse.ts:91 S.
  const feedResult = parser.feed(bytes);
  const endResult = parser.end();
  const overflow = parser.overflow; // S data/undefined, not Promise.
  const encodeSseFrameResult = encodeSseFrame({
    data: encodedEvent,
    event: "session",
    id: sequenceText,
  });
  const encodeSseCommentResult = encodeSseComment("heartbeat");
  const fifo = new FifoQueue<string>(); // ai/utils/fifo-queue.ts:7 S.
  fifo.enqueue("demo");
  const dequeueResult = fifo.dequeue();
  const length = fifo.length;
  fifo.clear(); // V/S, empty undefined NOT null.
  // Optional parser limit/frame event+id are omission, NOT null; no resource close.
}

/**
 * INTERNAL plugins/host.ts:112; scope.ts:14,88,97. NOT package exports.
 */
async function currentInternalPluginRuntime() {
  const host = new PluginHost(pluginHostTarget); // S, target coordinates registries/storage/env.
  try {
    const activateResult = await host.activate(plugins);
  } finally {
    await host.close();
  } // Activations only, not process MCP pool.
  const scope = new PluginScope("isolated-demo", reportScopeError); // S, budgetMs optional.
  try {
    scope.effect(setupScopedEffect);
  } finally {
    await scope.dispose();
  } // Reverse disposal, awaited calls, bounded cleanup.
  // INTERNAL builtin/subagents.ts:395; SDK installs delegation runtime automatically.
  const subagentsPluginResult = subagentsPlugin(subagentHost); // S definition, NOT public exported factory.
  // task/create/send/await/read/stop tool names; authority carries originating run/call/head.
  // INTERNAL lease.ts:13: leased execution helper; signals are cancellation, never null.
  const withLeaseRenewalResult = await withLeaseRenewal(
    { session, lease, ttlMs: 30_000, signal },
    runWithLeaseSignal,
  );
}

/**
 * Exact package.json export paths at HEAD; worker entries are NOT factories.
 */
function currentExportAndNegativeIndex() {
  return {
    core: [
      ".",
      "plugins",
      "plugin-source",
      "store",
      "postgres",
      "store-worker",
      "image-resize-worker",
    ],
    host: [
      ".",
      "catalog",
      "environment",
      "plugins",
      "settings",
      "otel",
      "store-usage",
      "usage",
      "usage-scan",
      "usage-worker",
    ],
    ai: [
      ".",
      "auth/context",
      "auth/helpers",
      "auth/types",
      "auth/credential-store",
      "auth/store",
      "auth/oauth/anthropic",
      "auth/oauth/github-copilot",
      "auth/oauth/openai-codex",
      "bun-oauth",
      "models",
      "providers/github-copilot",
      "providers/openai-codex",
      "providers/openrouter",
      "providers/vercel-ai-gateway",
      "session-resources",
      "types",
      "utils/event-stream",
      "utils/fifo-queue",
      "utils/overflow",
      "utils/retry",
      "utils/text",
      "utils/transcript",
      "utils/uuid",
      "utils/validation",
    ],
    protocol: [
      ".",
      "kernel/UI/views/plugins/workspace/sdk/remote/operations/environment/wire/parse/SSE/schemas families",
    ],
    client: [
      ".",
      "transport/fold/observer/outbox/context/tree/changes/live/transcript/usage/completion/tool projections",
    ],
    telemetry: [".", "otel"],
    server: [".", "node"],
    serve: ["."],
    cloudflare: [".", "sqlite", "agents", "routing"],
    vercel: [".", "workflow", "postgres", "outbox", "sandbox"],
    connect: [".", "signing", "relay", "enrollment", "account-config"],
    connectWorker: ["NO exports map; deployment index + named EnvironmentRelay"],
    plugin: [
      ".",
      "openai-compaction",
      "openai-astra-context",
      "mcp",
      "codemode",
      "codemode-runtime",
      "codemode-worker",
      "provider",
      "examples/bash-description",
      "examples/fast-mode",
      "examples/notifications",
      "examples/question",
      "examples/rename",
      "examples/web-search",
    ],
    unavailableRemote: [
      "messages.list/pending",
      "runs.wait/compact/context",
      "heads.list/create/delete/merge",
      "cacheWarming",
      "attach/advance/reactivate/sessionCwd/sessionWorkspace/relocate/close",
      "raw store/history/retained tree/GC",
      "core sessions.create.workspace",
      "full Models auth/streaming",
    ],
    unavailableHere: [
      "Grok factory",
      "interactive PTY input/resize",
      "browser panel/CDP",
      "connect package socket opener",
      "sandbox.create/stop export",
      "external exactly-once execution",
    ],
    surfacesCrossReference: [
      "ALL workspace/read/save/format/search/blame/VCS methods",
      "conversation /tree",
      "watch",
      "SessionObserver",
      "client createOutbox",
      "desktop files/changes/browser/terminal",
    ],
    // Root dispatch is PUBLIC core/sdk/dispatch.ts:78 A→OperationOutput, not scheduler:
    dispatch:
      "dispatch(sdk, operation, input); operation/input/output correlated by Operation generics",
    // Pure helpers/validators have data returns, NOT fluent receiver or resource ownership:
    aiPure:
      "Type/validation/transcript/text/UUID/estimate/pricing/prompt-cache/retry/failure/overflow/JSON/FifoQueue",
    hostPure:
      "paths/manifest/catalog/settings decode+patch/usage projections/source identity/discovery",
    clientPure:
      "foldEvent/snapshotOf/stateFromSnapshot/stateWithMetadata/tipMismatch/waitingCall/sessionMark and views",
    protocolPure:
      "sessionId/MAIN/head names/parseOperation/mediaType/statusFor/validationIssues/describeIssues/encodeSseFrame/encodeSseComment/createSseParser/schemas",
    internalOnly:
      "queue/admission/effects/stacks/turn/step/GC/compaction/delegations/jobs runtime/plugin scope/alarm drivers",
  }; // S plain inventory, NOT top-level executed I/O; no invented package export paths.
}

// Workbench and client examples

// PUBLIC client + PUBLIC store escape; no SDK/wire retained-graph fetch exists.
// packages/client/src/views/tree.ts:12-38,74-119; packages/core/src/kernel/store.ts:33-45
// packages/tui/src/host.ts:98-113; packages/core/src/kernel/sdk/types.ts:204-207
async function currentConversationTree(sdk: Nyte, store: Store, sessionId: SessionId) {
  const snapshot = await sdk.sessions.snapshot({ sessionId });
  if (snapshot === undefined) return; // Missing lookup, not null/unborn tip.
  const handle = await store.open(sessionId); // Acquired store Session, not SessionInfo.
  try {
    const commits = await handle.objects.commits(); // Retained loose/abandoned commits too.
    const tree = projectTree(commits, { tip: snapshot.tip, heads: snapshot.session.heads });
    // tree: roots[], tip:Oid|null, activePath:ReadonlySet<Oid>; not a JSON wire shape.
    // node: oid, commit, children[], active:boolean, depth:number, heads:string[].
    return { snapshot, commits, tree }; // Multi-read, not a coherent graph transaction.
  } finally {
    await handle.close(); // Releases read handle; does not delete durable session.
  }
}

// PUBLIC heads navigation + client projection; packages/core/src/kernel/sdk/types.ts:318-324
// packages/core/src/kernel/sdk/nyte.ts:635-739; packages/client/src/views/tree.ts:121-203
async function currentTreeMove(
  sdk: Nyte,
  sessionId: SessionId,
  data: NonNullable<Awaited<ReturnType<typeof currentConversationTree>>>,
  selectedOid: Oid,
  summarize: boolean,
) {
  const selected = data.commits.find((item) => item.oid === selectedOid);
  if (selected === undefined) return;
  const byOid = new Map(data.commits.map((item) => [item.oid, item.commit]));
  const abandoned = collectAbandoned(byOid, { from: data.snapshot.tip, selected: selectedOid });
  const target = navigationTarget(selected); // User -> parent+restore; others -> selected oid.
  const input = { sessionId, to: selectedOid, expect: data.snapshot.tip };
  const outcome = await sdk.heads.move(
    summarize && abandoned.commits.length > 0
      ? { ...input, summary: { customInstructions: "Keep abandoned findings" } }
      : input,
  );
  // to:null = start. expect omitted = no caller assertion; expect:null asserts unborn.
  // summary omitted = plain move; summary:{} = request default summary. No signal here.
  // moved.restored? is draft handback, NOT filesystem restore; summary? is summary oid.
  // TUI waits for observed rewind AND empty composer before applying restored.content.
  return { target, abandoned, outcome }; // Typed moved/busy/moved_since/not_found/failed data.
}

// PUBLIC local heads; remote exposes move ONLY. No sessions.fork or fluent head handle.
// packages/core/src/kernel/sdk/types.ts:311-329; packages/lab/server/review.ts:418-469
async function currentHeadFork(
  sdk: Nyte,
  sessionId: SessionId,
  model: Model<Api>,
  thinkingLevel: ThinkingLevel,
  question: string,
  key: string,
) {
  const heads = await sdk.heads.list({ sessionId });
  const created = await sdk.heads.create({ sessionId, head: "side", from: { head: "main" } });
  if (created.kind === "unknown_parent") return created;
  if (created.kind === "created") {
    const configured = await sdk.sessions.configure({
      sessionId,
      head: "side",
      model: { provider: model.provider, id: model.id },
      thinkingLevel,
    });
    if (configured.kind !== "queued") return configured;
  }
  const sent = await sdk.messages.send({ sessionId, head: "side", content: question, key });
  // Separate calls, not atomic fork+pin+send. key omission loses idempotent retry intent.
  return { heads, created, sent };
}

async function currentHeadAdministration(sdk: Nyte, sessionId: SessionId, commit: Oid) {
  const created = await sdk.heads.create({ sessionId, head: "cut", from: { commit } });
  const merged = await sdk.heads.merge({ sessionId, head: "side" }); // Stack fast-forward.
  const deleted = await sdk.heads.delete({ sessionId, head: "cut" }); // main throws.
  return { created, merged, deleted }; // Never a Git branch operation; no closeable handle.
}

// PUBLIC/HOST-ONLY long operation; not on remote wire or app bridge.
// packages/core/src/kernel/sdk/types.ts:278-293; packages/tui/src/interactive.ts:4546-4588
async function currentCompact(sdk: Nyte, sessionId: SessionId, signal: AbortSignal) {
  const context = await sdk.runs.context({ sessionId });
  const compacted = await sdk.runs.compact({
    sessionId,
    customInstructions: "Keep file paths",
    signal,
  });
  const settled = await sdk.runs.wait({ sessionId, signal });
  // head? defaults main; instructions? omitted uses default; null is not admitted.
  // signal ends this operation, not durable session lifetime. Outcomes are not chainable.
  return { context, compacted, settled };
}

// PUBLIC local AND remote; app RunsBridge excludes revert despite wire support.
// packages/protocol/src/operations.ts:251-270; packages/core/src/kernel/sdk/reads.ts:435-593
async function currentRunFiles(sdk: Nyte | RemoteNyte, sessionId: SessionId, runId: string) {
  const evidence = await sdk.runs.diff({ sessionId, runs: [runId] }); // Nonempty run tuple.
  const record = evidence[0];
  if (record?.diff.kind !== "tree") return evidence; // recorded fallback/not_found != restoreable.
  const restored = await sdk.runs.revert({ sessionId, runId, expect: record.diff.to });
  // expect is REQUIRED TreeId, not conversation Oid or VCS revision digest.
  // Current affected blobs must match expect; never silently retry with fresh expectation.
  // Restores changed paths to run start; no conversation ref/HEAD/index rewind.
  // reverted/busy/conflict/no_tree/not_found/failed; no resource acquired or chained.
  return { evidence, restored };
}

// PUBLIC core/remote stateless file namespace; target must be explicit.
// packages/protocol/src/operations.ts:337-366; packages/protocol/src/schemas.ts:1282-1405
async function currentWorkspaceFiles(sdk: Nyte | RemoteNyte, sessionId: SessionId, path: string) {
  const target: WorkspaceTarget = { kind: "session", sessionId };
  const all = await sdk.workspace.files({ target }); // No query: capped discovered list.
  const ranked = await sdk.workspace.files({ target, query: "src" }); // Default 50 rows.
  const document = await sdk.workspace.read({ target, path }); // text/binary/too_large.
  const search = await sdk.workspace.search({
    target,
    query: "TODO",
    caseSensitive: false,
    wholeWord: true,
    regex: false,
    include: ["src/**"],
    exclude: ["**/*.test.ts"],
    maxMatches: 50,
    drafts: [{ path, contents: "TODO in unsaved draft" }],
  });
  const blame = await sdk.workspace.blame({ target, path });
  if (document.kind !== "text") return { all, ranked, document, search, blame };
  const formatted = await sdk.workspace.format({
    target,
    path,
    contents: document.contents,
    version: document.version,
  }); // Format doesn't save.
  if (formatted.kind !== "formatted") return { document, formatted, search, blame };
  const saved = await sdk.workspace.save({
    target,
    path,
    contents: formatted.contents,
    version: formatted.version,
  });
  // Optional search flags/drafts = defaults/omitted, never null; version REQUIRED.
  // saved/conflict data, no FileHandle and no filesystem subscribe/close namespace.
  return { all, ranked, document, formatted, saved, search, blame };
}

// PUBLIC all VCS calls; mutations require reviewed revision, freshly read per write.
// packages/protocol/src/operations.ts:276-336; packages/app/src/workbench/changes-commit-bar.tsx:379-505
async function currentAllVcs(sdk: Nyte | RemoteNyte, path: string, commit: string, base: string) {
  const target: WorkspaceTarget = { kind: "workspace" };
  const registry = await sdk.workspace.list();
  const selection = await sdk.workspace.current();
  const status = await sdk.workspace.vcs.snapshot({ target });
  const refs = await sdk.workspace.vcs.refs({ target });
  const log = await sdk.workspace.vcs.log({ target, limit: 20, before: commit });
  const working = await sdk.workspace.vcs.diff({
    target,
    scope: { kind: "worktree" },
    ignoreWhitespace: false,
  });
  const staged = await sdk.workspace.vcs.diff({
    target,
    scope: { kind: "staged" },
    paths: [path],
    ignoreWhitespace: true,
  });
  const unstaged = await sdk.workspace.vcs.diff({
    target,
    scope: { kind: "unstaged" },
    ignoreWhitespace: false,
  });
  const committed = await sdk.workspace.vcs.diff({
    target,
    scope: { kind: "commit", oid: commit },
    ignoreWhitespace: false,
  });
  const branch = await sdk.workspace.vcs.diff({
    target,
    scope: { kind: "branch", base },
    ignoreWhitespace: false,
  });
  const contents = await sdk.workspace.vcs.contents({ target, scope: { kind: "staged" }, path });
  if (status.kind !== "repository") return { registry, selection, refs, log, working };
  const stage = await sdk.workspace.vcs.stage({
    target,
    paths: [path],
    staged: true,
    expect: { revision: status.revision },
  });
  const afterStage = await sdk.workspace.vcs.snapshot({ target });
  if (stage.kind !== "applied" || afterStage.kind !== "repository") return stage;
  const unstage = await sdk.workspace.vcs.stage({
    target,
    paths: [path],
    staged: false,
    expect: { revision: afterStage.revision },
  });
  const afterUnstage = await sdk.workspace.vcs.snapshot({ target });
  if (unstage.kind !== "applied" || afterUnstage.kind !== "repository") return unstage;
  const created = await sdk.workspace.vcs.createBranch({
    target,
    name: "review",
    checkout: true,
    expect: { revision: afterUnstage.revision },
  });
  const afterBranch = await sdk.workspace.vcs.snapshot({ target });
  if (created.kind !== "created" || afterBranch.kind !== "repository") return created;
  const saved = await sdk.workspace.vcs.commit({
    target,
    message: "Save reviewed changes",
    files: { kind: "all" },
    expect: { revision: afterBranch.revision },
  });
  const afterCommit = await sdk.workspace.vcs.snapshot({ target });
  if (saved.kind !== "committed" || afterCommit.kind !== "repository") return saved;
  const pushed = await sdk.workspace.vcs.push({
    target,
    setUpstream: false,
    expect: { revision: afterCommit.revision },
  });
  // commit files also {kind:"staged"} or {kind:"paths",paths:[path]}; no null reset.
  // before?/paths? omitted = default scope; failed/stale/busy are explicit outcomes.
  return { staged, unstaged, committed, branch, contents, stage, unstage, created, saved, pushed };
}
// Independent destructive action, never preparation for commit. Keep the reviewed expectation.
// packages/core/src/kernel/sdk/types.ts:444-450; protocol/src/operations.ts:300-303
async function currentDiscardReviewed(
  sdk: Nyte | RemoteNyte,
  target: WorkspaceTarget,
  path: string,
  reviewedRevision: string,
) {
  return sdk.workspace.vcs.discard({
    target,
    paths: [path],
    expect: { revision: reviewedRevision },
  });
  // applied/failed/stale/busy; do not refresh-and-retry a rejected destructive write.
}

async function currentWorkspaceSelection(sdk: Nyte | RemoteNyte, path: string) {
  const project = await sdk.workspace.select({ kind: "project", path });
  const home = await sdk.workspace.select({ kind: "home" });
  await sdk.workspace.forget({ path });
  // Core serves one workspace; desktop share cursor retargets, not session relocation.
  return { project, home }; // Promise<outcome>, no connectable workspace handle.
}

// PUBLIC @nyte-ai/host direct escape hatches, caller owns trust and Node execution.
// packages/host/src/index.ts:47-77,131; workspace-backend.ts:13-30; tree-snapshot.ts:335-481
async function currentHostFiles(
  cwd: string,
  path: string,
  absoluteDiscardPath: string,
  signal: AbortSignal,
) {
  const registry = createWorkspaceStore(); // No close/watch method.
  const resolved = await registry.resolve(cwd); // Doesn't grant trust.
  const backend = createWorkspaceBackend(registry);
  const files = await discoverMentionFiles(cwd, signal);
  const ranked = rankMentionFiles(files, "src", 20);
  const real = await resolveWorkspaceFile(cwd, path);
  const read = await readWorkspaceFile(cwd, path);
  const blame = await blameWorkspaceFile(cwd, path);
  const search = await searchWorkspaceFiles(cwd, { query: "TODO", maxMatches: 50 }, signal);
  if (read.kind === "text") {
    const formatted = await formatWorkspaceFile(cwd, {
      path,
      contents: read.contents,
      version: read.version,
    });
    if (formatted.kind === "formatted")
      await saveWorkspaceFile(cwd, {
        path,
        contents: formatted.contents,
        version: formatted.version,
      });
  }
  const vcs = createGitVcs({ beforeCommand: async () => {} });
  const snapshots = createTreeSnapshot();
  const from = await snapshots.tree({ cwd });
  const to = await vcs.tree({ cwd });
  if (from.kind === "tree" && to.kind === "tree") {
    const changes = await snapshots.diffTrees({ cwd, from: from.id, to: to.id, paths: [path] });
    await snapshots.restoreTree({ cwd, from: from.id, expect: to.id, paths: changes });
  }
  // Both factories accept discard? callback; omit = shadow trash, not null.
  await snapshots.discard({ cwd, absolutePath: absoluteDiscardPath }); // Explicit destructive trash move.
  return { resolved, backend, files, ranked, real, read, blame, search };
}

// INTERNAL app bridge, HOST-ONLY native UI; not Nyte.browser, absent web/mobile.
// packages/app/src/bridge.ts:633-654,774; desktop/src/main/host.ts:715-730
async function currentBrowserBridge(host: HostBridge, surface: string, cwd: string, url: string) {
  const browser = host.browser; // ? = capability absent, not page closed/unloaded.
  if (browser === undefined) return;
  const events: HostEvent[] = [];
  const unsubscribe = host.onEvent((event) => {
    events.push(event);
  });
  try {
    const state = await browser.open({ surface, url, owner: { kind: "project", path: cwd } });
    // open returns state immediately, NOT a settled PageHandle; owner? defaults Home.
    await browser.navigate({ surface, action: "back" });
    await browser.navigate({ surface, action: "forward" });
    await browser.navigate({ surface, action: "reload" });
    await browser.navigate({ surface, action: "stop" });
    const menu = await browser.menu({ surface, bookmarksVisible: false, x: 20, y: 20 });
    await browser.perform({ surface, action: "screenshot" });
    await browser.perform({ surface, action: "hard-reload" });
    await browser.perform({ surface, action: "copy-url" });
    await browser.perform({ surface, action: "clear-history" });
    await browser.perform({ surface, action: "clear-cookies" });
    await browser.perform({ surface, action: "clear-cache" });
    const frame = await browser.captureFrame({ surface }); // undefined = unavailable pixels.
    return { state, menu, frame, events };
  } finally {
    await browser.close({ surface }); // VIEW hold only; agent may retain page.
    unsubscribe(); // Listener only; no model-work cancellation.
  }
}

// INTERNAL/HOST-ONLY agent capability, not public SDK; all actual methods.
// packages/desktop/src/main/browser-agent.ts:102-207; browser-tools.ts:287-322
async function currentBrowserAgent(
  agent: BrowserAgent,
  session: SessionId,
  cwd: string,
  url: string,
  signal: AbortSignal,
) {
  try {
    const opened = await agent.open({
      session,
      owner: { kind: "project", path: cwd },
      url,
      signal,
    });
    if (opened.kind !== "ok") return opened;
    const snapshot = await agent.snapshot({ session, signal });
    if (snapshot.kind !== "ok") return snapshot;
    const node = snapshot.state.nodes.find((entry) => entry.editable === true && entry.name !== "");
    if (node !== undefined) {
      // Generation-stamped ref from the report, not a fabricated ref literal.
      const typed = await agent.type({
        session,
        ref: node.ref,
        expect: node.name,
        text: "nyte",
        clear: true,
        signal,
      });
      if (typed.kind === "ok") {
        const current = typed.state.nodes.find((entry) => entry.name === node.name);
        if (current !== undefined)
          await agent.click({
            session,
            ref: current.ref,
            expect: current.name,
            button: "left",
            double: false,
            signal,
          });
      }
    }
    await agent.press({ session, key: "Enter", signal });
    await agent.scroll({ session, direction: "down", pages: 1, signal });
    await agent.wait({ session, until: "load", signal });
    await agent.wait({ session, until: "text", text: "Ready", signal });
    await agent.wait({ session, until: "gone", text: "Loading", signal });
    await agent.wait({ session, until: "time", seconds: 0.2, signal });
    const consoleEntries = agent.console({ session, limit: 50, clear: true }); // Synchronous.
    const evaluated = await agent.evaluate({ session, expression: "document.title", signal });
    const png = await agent.capture({ session }); // Bytes|undefined, not a page handle.
    return { consoleEntries, evaluated, png, surface: agent.sessionSurfaceId(session) };
  } finally {
    agent.release({ session });
  }
  // ref?/signal? = defaults; null not admitted. Agent calls bypass plugin access gate.
  // Native agent doesn't verify expect; tools plugin checks last-shown accessible name.
}

// INTERNAL native construction/plugin lifecycle; real Electron dependencies supplied.
// packages/desktop/src/main/browser.ts:95-145,185,166-176; browser-tools.ts:143-150,217
async function currentNativeBrowser(
  dependencies: BrowserSurfacesDependencies,
  window: HostWindow,
  session: SessionId,
  accessFile: string,
  folder: string,
  approved: BrowserAccessLevel,
  url: string,
  use: (surfaces: BrowserSurfaces) => Promise<void>,
) {
  const surfaces = createBrowserSurfaces(dependencies);
  const access = new BrowserAccessStore(accessFile);
  const plugin = browserToolsPlugin({ agent: surfaces.agent, access, defaultAccess: () => "ask" });
  const previousAccess = await access.read(folder); // undefined = ask/default, never null.
  await access.remember(folder, approved); // Persist explicit user-approved read/full/off; no dispose.
  const surface = surfaces.agent.sessionSurfaceId(session);
  const holder: BrowserHolder = `session:${session}`;
  await surfaces.warm();
  surfaces.retain({ surface, holder, owner: { kind: "home" } });
  try {
    const state = surfaces.open({ surface, url, owner: { kind: "home" } }, window); // Sync.
    surfaces.navigate({ surface, action: "reload" });
    await surfaces.menu({ surface, bookmarksVisible: false, x: 20, y: 20 }, window);
    await surfaces.perform({ surface, action: "copy-url" }, window);
    await surfaces.captureFrame({ surface });
    await use(surfaces); // Install plugin in real host composition separately.
    return { state, plugin, previousAccess };
  } finally {
    surfaces.close({ surface }); // Releases view, NOT session holder.
    surfaces.release({ surface, holder });
    surfaces.releaseWindow(window); // Manager has no global close/dispose method.
  }
  // Agent-only idle pool capped at 6: a retained page can still be reclaimed.
  // Plugin activation signal releases session; read/full/off gate, all tools foreground.
}

// INTERNAL renderer/native-window placement ONLY; never conversation/core contract.
// packages/app/src/workbench/browser-panel.tsx:239-339; desktop/src/main/browser.ts:873-903
function currentNativePagePlacement(
  browser: BrowserBridge,
  surfaces: BrowserSurfaces,
  surface: string,
  window: HostWindow,
) {
  const bounds = { x: 0, y: 80, width: 900, height: 600 };
  browser.setBounds({ surface, bounds, visible: true }); // One-way IPC, void.
  surfaces.setBounds({ surface, bounds, visible: false }, window); // Main-side alternative.
  // Occluding DOM overlays hide native view; high z-index alone cannot cover it.
}

// INTERNAL app PTY bridge; native service routes by window, no core PTY namespace.
// packages/app/src/bridge.ts:613-621; desktop/src/main/host.ts:731-764
async function currentPtyBridge(
  host: HostBridge,
  id: string,
  workspacePath: string | null,
  consume: (data: string) => Promise<void>,
) {
  const terminal = host.terminal;
  if (terminal === undefined) return; // Optional capability, not exited process.
  let consumed = Promise.resolve();
  const unsubscribe = host.onEvent((event) => {
    if (event.kind === "terminal_data" && event.id === id) {
      consumed = consumed
        .then(() => consume(event.data))
        .then(() => terminal.acknowledge({ id, length: event.data.length }));
      void consumed.catch(() => undefined); // Finalization propagates consumption failure.
    }
  });
  try {
    const info = await terminal.create({ id, workspacePath }); // Required null = OS homedir.
    await terminal.resize({ id, cols: 100, rows: 30 });
    await terminal.write({ id, data: "pwd\r" });
    const idle = await terminal.idle({ id });
    return { info, idle }; // Data, not info.write(...); no fluent chaining.
  } finally {
    unsubscribe();
    try {
      await consumed;
    } finally {
      await terminal.close({ id });
    }
  }
}

// INTERNAL/HOST-ONLY synchronous PTY service; shells owned by native window.
// packages/desktop/src/main/terminals.ts:25-160; app/src/workbench/terminal-runtime.ts:397-424
function currentPtyService(emit: (event: HostEvent) => void, cwd: string, id: string) {
  const service = new TerminalSessions(emit, () => null); // null selects login shell.
  try {
    const info = service.create({ id, cwd }); // Sync, max 32 per service.
    service.resize({ id, cols: 80, rows: 24 });
    service.write({ id, data: "pwd\r" });
    service.acknowledge({ id, length: 0 });
    const idle = service.idle({ id });
    const busy = service.busyCount();
    service.close({ id }); // Kills PTY, unlike DOM unmount/job-output close.
    return { info, idle, busy };
  } finally {
    service.dispose();
  }
}

// PUBLIC @nyte-ai/core/plugins environment capability; NOT PTY or durable job.
// packages/core/src/plugins/index.ts:51-57; tools/env.ts:91-100; kernel/loop/env.ts:14-54
async function currentEnvironmentProcess(id: string, cwd: string, signal: AbortSignal) {
  const env = createLocalExecutionEnv({ id, cwd });
  const path = env.resolve("src", "index.ts");
  const metadata = await env.stat(path); // undefined missing, not null.
  const real = await env.realpath(path); // undefined missing.
  const files = await env.readdir(env.resolve("src"));
  const bytes = await env.readFile(path);
  await env.mkdir(env.resolve("scratch"));
  await env.writeFile(env.resolve("scratch", "note.txt"), "Reviewed");
  const output: Buffer[] = [];
  const ended = await env.exec("pwd", {
    onData: (data) => {
      output.push(data);
    },
    signal,
    timeout: 5,
  });
  // Exec result {exitCode}; signal?/timeout? omitted = no explicit bound, null invalid.
  // No process handle/resize/write/close. ExecutionEnv identity fixed; no resource close.
  return { path, metadata, real, files, bytes, output, ended };
}

// PUBLIC core/remote command jobs; durable metadata != process survives host shutdown.
// packages/protocol/src/operations.ts:194-207; app/src/workbench/terminal-store.ts:346-361
async function currentCommandJobs(sdk: Nyte | RemoteNyte, sessionId: SessionId) {
  const job = await sdk.jobs.start({ sessionId, command: "git status --short" });
  const jobs = await sdk.jobs.list({ sessionId }); // head? omitted lists across heads.
  const background = await sdk.jobs.background({ sessionId, jobId: job.id });
  const cancelled = await sdk.jobs.cancel({ sessionId, jobId: job.id });
  // User job has no run/completion; closing output-view doesn't call jobs.cancel.
  return { job, jobs, background, cancelled }; // Outcomes, no chained JobHandle.
}

// INTERNAL TUI !/!! shell; caller chooses retained output, not core job/PTY ownership.
// packages/tui/src/local-shell.ts:8-26,66-71; slash.ts:27,88-92
async function currentTuiLocalShell(
  cwd: string,
  signal: AbortSignal,
  onUpdate: (snapshot: ShellExecution) => void,
) {
  const process = startLocalShell({ command: "pwd", cwd, signal, onUpdate });
  const initial = process.snapshot;
  process.cancel(); // Illustrates explicit owned cancellation, not observer unsubscribe.
  const final = await process.done;
  return { initial, final }; // ShellProcess has cancel, not resize/write/close.
}

// PUBLIC client transport; no close(), client object is not an acquired connection.
// packages/client/src/index.ts:129-160; protocol/src/remote.ts:105-128
async function currentRemoteObservation(
  baseUrl: string,
  token: string,
  sessionId: SessionId,
  signal: AbortSignal,
) {
  const client = createNyteClient({ baseUrl, token }); // token? omitted for non-bearer host.
  const info = await client.info();
  const snapshot = await client.sessions.snapshot({ sessionId });
  if (snapshot === undefined) return info;
  const events: SessionEvent[] = [];
  for await (const event of client.watch({ sessionId, afterSeq: snapshot.seq, signal })) {
    events.push(event);
    if (event.kind === "synced") break; // Iterator return closes this watch, not host work.
  }
  // Alternative watch {sessionId,live:true,signal}; no nullable cursor.
  return { info, snapshot, events };
}

// PUBLIC client observer; local/remote client needs only snapshot/metadata/watch.
// packages/client/src/session/session-follow.ts:45-59,105-191
async function currentObserver(
  client: SessionObserverClient,
  sessionId: SessionId,
  runId: RunId,
  consume: (observer: SessionObserver) => Promise<void>,
) {
  const observer = new SessionObserver(client, {
    sessionId,
    head: "main",
    retryMs: 1000,
    selectionVersion: () => 0,
    onError: (error) => {
      void error;
    },
  });
  const updates: SessionUpdate[] = [];
  const unsubscribe = observer.subscribe((update) => {
    updates.push(update);
  });
  try {
    const initial = await observer.start(); // Resolves first snapshot, continues observing.
    observer.refresh(); // Metadata only, void, not chainable.
    observer.requestStop(runId); // Display intent only; does NOT send runs.abort.
    const fresh = await observer.resync();
    await consume(observer);
    return { initial, fresh, state: observer.state, updates };
  } finally {
    unsubscribe();
    observer.close();
  } // Observation only.
}

// PUBLIC client outbox; packages/client/src/outbox.ts:45-73,146,378-407
async function currentOutbox(
  sdk: Nyte | RemoteNyte,
  sessionId: SessionId,
  storage: OutboxStorage,
  update: SessionUpdate,
) {
  const outbox = createOutbox({ send: (input) => sdk.messages.send(input), storage });
  // storage? omitted => memory only; no null. schedule/now/mintKey? injectable defaults.
  const unsubscribe = outbox.subscribe(() => {
    void outbox.rows();
  });
  try {
    await outbox.activate(); // Reload persisted unsent records and retry original keys.
    const key = await outbox.submit({ sessionId, content: "Review files", delivery: "next" });
    // submit resolves when locally stored, NOT necessarily server admission or run completion.
    outbox.observe(update); // Actual observer updates remove drawn durable rows.
    const withdrawal = outbox.withdraw(key); // Promise<durable|withdrawn> OR undefined.
    return withdrawal === undefined ? outbox.rows() : await withdrawal;
  } finally {
    unsubscribe();
  } // Outbox has NO close/dispose; listener stop won't cancel retries.
}

// PUBLIC configure/send sequencing; neither outcome offers fluent session methods.
// packages/core/src/kernel/sdk/nyte.ts:346-456; protocol/src/sdk.ts:196-221
async function currentConfiguration(
  sdk: Nyte,
  sessionId: SessionId,
  model: Model<Api>,
  key: string,
) {
  const config = await sdk.sessions.configure({
    sessionId,
    model: { provider: model.provider, id: model.id },
  });
  if (config.kind !== "queued") return config;
  const steer = await sdk.messages.send({
    sessionId,
    content: "Adjust direction",
    delivery: "steer",
    key,
  });
  const queue = await sdk.messages.send({
    sessionId,
    content: "Then review",
    delivery: "next",
    key: `${key}:next`,
  });
  const moved = await sdk.messages.redeliver({
    sessionId,
    change: queue.change,
    delivery: "next",
    before: null,
  });
  const changed = await sdk.messages.redeliver({
    sessionId,
    change: queue.change,
    delivery: "steer",
    content: "Review now",
  });
  const cancelled = await sdk.messages.cancel({ sessionId, change: steer.change });
  // before omitted = keep position, null = last, oid = before item. Edits may race landing.
  // Config fields omitted = unchanged; no null reset. Await order != per-message config pin.
  // delivery? defaults steer when live, next when idle. No current .steer/.queue/.branch.
  return { config, steer, queue, moved, changed, cancelled };
}

// INTERNAL TUI ordering, not shared SDK; packages/tui/src/session-config.ts:38-58,146-331
// Caller packages/tui/src/interactive.ts:2173-2223 uses outbox.submit via send.
async function currentTuiConfiguration(
  options: SessionConfiguratorOptions,
  patch: ConfigPatch,
  outbox: Outbox,
  sessionId: SessionId,
  update: SessionUpdate,
) {
  const config = new SessionConfigurator(options);
  const requested = config.request(patch); // Selection updated optimistically.
  const slot = config.reserveSubmission(); // Reserve synchronously before preparation yields.
  try {
    const result = await slot.configured;
    if (result !== undefined && result.kind !== "acknowledged") return result;
    const key = await outbox.submit({
      sessionId,
      content: "Use selected choice",
      delivery: "next",
    });
    // Current outbox resolves at local storage; slot release isn't guaranteed durable admission.
    if (update.selectedVersion !== undefined) config.observeSelected(update.selectedVersion);
    return { requested: await requested, selected: config.selected, pending: config.pending, key };
  } finally {
    slot.release();
    config.dispose();
  } // No cancellation of already-reserved work.
}

// INTERNAL app draft state; file-document.ts:26-152. Not an OS FileHandle.
async function currentFileDraft(sdk: RemoteNyte, target: WorkspaceTarget, path: string) {
  const read = await sdk.workspace.read({ target, path });
  if (read.kind !== "text") return read;
  const document = createFileDocument(read); // draft? omitted -> disk text, no null.
  const unsubscribe = document.subscribe(() => {
    void document.getSnapshot();
  });
  try {
    document.edit(`${read.contents}\n`);
    await document.save({
      write: (input) => sdk.workspace.save({ target, ...input }),
      format: (input) => sdk.workspace.format({ target, ...input }),
    }); // Promise<void>.
    const fresh = await sdk.workspace.read({ target, path });
    if (fresh.kind === "text") {
      document.observeDisk(fresh);
      document.discard(fresh);
    }
    return document.getSnapshot(); // contents/savedContents/version/revision/status.
  } finally {
    unsubscribe();
  } // No document.close; unsubscribe neither saves nor discards.
}

// INTERNAL UI openers/layout ONLY; packages/app/src/workbench/controller.ts:18-58,196-230
// file-store.ts:88-345; open-reference.ts:12-63; terminal-runtime.ts:397-424
async function currentWorkbenchUi(
  controller: WorkbenchController,
  cwd: string,
  path: string,
  container: HTMLDivElement,
  reference: Parameters<ReferenceOpener>[0],
) {
  const view = workbenchViewKey(cwd);
  const unsubscribe = controller.subscribe(() => {
    void controller.getSnapshot();
  });
  try {
    const files = createFileTabStore(controller);
    const stopFiles = files.subscribe(() => {
      void files.getView(view);
    });
    try {
      files.actions.open(view, { path, line: 1, column: 1, length: 5, preview: true });
      files.actions.pin(view, path);
      files.actions.reveal(view, "src/");
      files.actions.back(view);
      files.actions.forward(view);
      const filesystem = controller.actions.openTab({
        view,
        activate: false,
        tab: { kind: "files" },
      });
      const changes = controller.actions.openTab({
        view,
        activate: true,
        tab: {
          kind: "changes",
          scope: { kind: "uncommitted" },
          selectedPath: null,
          pathRevealRevision: 0,
          scrollTop: 0,
        },
      });
      const browser = controller.actions.openTab({
        view,
        activate: false,
        tab: { kind: "browser", url: "https://example.com" },
      });
      const terminal = controller.actions.openTab({
        view,
        activate: false,
        tab: { kind: "terminal", owner: { kind: "user" } },
      });
      try {
        await terminalActions.create({ id: terminal, workspacePath: cwd });
        const detach = mountTerminal(terminal, container, false); // DOM only.
        try {
          const opener = workbenchReferenceOpener({ viewKey: view, workspacePath: cwd });
          opener(reference)?.();
          const closed = files.actions.close(view, path);
          if (!closed) files.actions.cancelClose(view);
          controller.actions.closeTab({ view, id: changes });
          return { filesystem, browser, terminal, closed }; // Layout IDs, not SDK handles.
        } finally {
          detach();
        }
      } finally {
        try {
          await terminalActions.close(terminal);
        } // Explicit owned PTY termination.
        finally {
          controller.actions.closeTab({ view, id: terminal });
        }
      }
    } finally {
      stopFiles();
    } // Runs even when PTY close fails.
  } finally {
    unsubscribe();
  }
  // Files/browser tabs intentionally remain in the shared controller. No owned
  // native browser hold was acquired here; its panel owns that separate lifetime.
}

// INTERNAL job-output opener; terminal-store.ts:362-402. Closing doesn't jobs.cancel.
async function currentJobOutput(
  controller: WorkbenchController,
  view: WorkbenchViewKey,
  sessionId: SessionId,
  job: JobInfo,
) {
  const id = openJobTerminal({ controller, view, sessionId, job, activate: true });
  try {
    await terminalActions.close(id);
  } // Presentation only, NOT jobs.cancel.
  finally {
    controller.actions.closeTab({ view, id });
  }
}

// INTERNAL product connectors at the same HEAD. No connector is a fluent core handle.
// HOST-ONLY DesktopHost: main/host.ts:143-192,445-468,996-1136; shared/ipc.ts:152-200.
// Required deps: createModels, storeWorker:URL, browser:BrowserSurfaces, emitHostEvent,
// emitWatchEvent, openExternal, confirmExternal, revealPath, showContextMenu, listFonts,
// pickFolder. Optional connect/settings/createHost/usageScan/remoteAccessPlugins/etc use
// ? = injected authority absent/default; picker Promise<string|undefined> means cancelled.
async function currentDesktopHost(
  dependencies: DesktopHostDependencies,
  window: HostWindow,
  sessionId: SessionId,
  watchId: string,
  path: string,
  use: (host: DesktopHost) => Promise<void>,
) {
  const host = new DesktopHost(dependencies); // Initializes registries/settings/telemetry resources.
  try {
    await host.prepare(window); // Promise<OpenLocalTarget>, not a closeable target handle.
    await host.call(window, "host.openWorkspace", { path });
    const snapshot = await host.call(window, "sessions.snapshot", { sessionId });
    host.watchStart(window, { watchId, sessionId, live: true }); // void; emits through deps.
    // afterSeq? omitted replays start unless live; null invalid. No signal field over IPC.
    try {
      await use(host);
    } finally {
      host.watchStop(watchId);
    } // Observation only.
    await host.call(window, "host.revealPath", { path });
    await host.call(window, "host.closeWorkspace", undefined); // No-arg IPC input is undefined.
    return snapshot;
  } finally {
    host.closeWindow(window); // Selection+watches+PTYs; reload uses releaseWindow instead.
    dependencies.browser.releaseWindow(window); // Separate native manager ownership.
    await host.close(); // Closes targets/shares/connect/account/telemetry, not browser manager.
  }
}
// INTERNAL native remote client: host.ts:2341-2368; app/bridge.ts:727-734.
async function currentDesktopServer(
  host: DesktopHost,
  window: HostWindow,
  baseUrl: string,
  token: string,
) {
  const connected = await host.call(window, "host.server.connect", { baseUrl, token });
  if (connected.kind !== "connected") return connected;
  try {
    return await host.call(window, "host.server.createSession", undefined);
  } finally {
    await host.call(window, "host.server.disconnect", undefined);
  } // Clears saved bearer/watch rows, no run abort.
}

// INTERNAL web: app/src/web/bridge.ts:19-27,70-100,321-360; connection.ts:92-101.
async function currentWebConnection(
  connection: Parameters<WebBridge["connect"]>[0],
  signal: AbortSignal,
  use: (bridge: NyteBridge) => Promise<void>,
) {
  const web = createWebBridge();
  const stop = web.bridge.host.onEvent(() => {});
  try {
    const info = await web.connect(connection, { signal, relay: true }); // Promise<ServerInfo>.
    await use(web.bridge);
    return info;
  } finally {
    stop();
  } // No web.close/reset/disconnect. connect internally directory.reset().
  // options?/signal?/relay?:true; not null/false. Signal binds verification only.
  // One page-lifetime interval+visibility listener; host.server.disconnect rejects here.
}

async function currentWebForget(config: Parameters<typeof releaseStoredAccountDevice>[0]) {
  await releaseStoredAccountDevice(config); // Undefined config accepted; managed bearer release.
  forgetConnection();
  location.replace("/"); // Credential removal+page replacement, not SDK.close.
}

// INTERNAL mobile: connection/host.ts:30-85; connection-store.ts:9-64,106-179.
async function currentMobileConnection(
  storage: ConnectionStorage,
  policy: ManagedPolicy | undefined,
  connection: Parameters<typeof connectHost>[0],
  signal: AbortSignal,
  release: (saved: SavedConnection) => Promise<unknown>,
) {
  const connected = await connectHost(connection, signal); // Probes then saves GLOBAL Keychain store.
  if (connected.kind !== "connected") return connected;
  const saved: SavedConnection = { kind: "manual", connection }; // connection = name,url,token.
  const client = createHostClient(saved); // Managed alternative adds binding, strips cookies.
  const info = await client.info(); // Client has no close/disconnect; SSE owns its own signal.
  const store = createConnectionStore(storage, policy); // Separate injected store, not global one.
  const stop = store.subscribe(() => {
    void store.getSnapshot();
  });
  try {
    await store.load();
    await store.save(saved, signal);
    return await store.remove({
      match: (candidate): candidate is SavedConnection => candidate === saved,
      release,
    }); // release precedes storage deletion; unmatched -> undefined, never null.
  } finally {
    stop();
    void info;
  } // No store.close. Storage.read null = no saved text.
  // policy is REQUIRED T|undefined, not ?. Save abort may undo write, failure can leave unknown.
}

// INTERNAL/HOST-ONLY broker: main/connect-broker.ts:32-41,95-236. fetch? default global.
async function currentDesktopBroker(
  origin: string,
  key: PrivateJwk,
  name: string,
  sessionToken: string,
  signal: AbortSignal,
) {
  const broker = new DesktopBroker({ origin }); // Canonical HTTPS required; no close/subscribe.
  const linked = await broker.link({ key, name, sessionToken, signal }); // Promise<LinkResponse>.
  return { broker, linked }; // Session JWT sent once, not retained; link isn't a resource handle.
}

async function currentBrokerLease(
  broker: DesktopBroker,
  key: PrivateJwk,
  environmentId: string,
  signal: AbortSignal,
) {
  return {
    address: broker.address(environmentId),
    socket: broker.relayUrl(environmentId),
    proof: await broker.relayProof({ key, environmentId }),
    keys: await broker.keys({ signal }),
    lease: await broker.lease({ key, environmentId, signal }),
  }; // lease/request/sentAt data.
}

async function currentBrokerRemoval(
  broker: DesktopBroker,
  key: PrivateJwk,
  environmentId: string,
  deviceId: string,
  signal: AbortSignal,
  action: "release" | "revoke" | "remove",
) {
  if (action === "release") return broker.releaseDevice({ key, environmentId, deviceId, signal });
  if (action === "revoke") return broker.revokeDevice({ key, environmentId, deviceId, signal });
  return broker.removeEnvironment({ key, environmentId, signal }); // Each Promise<void>, independent destructive intent.
}

// INTERNAL/HOST-ONLY relay: main/connect-relay.ts:55-66,117-158; runtime.ts:707-741.
async function currentRelay(
  url: string,
  port: number,
  proof: () => Promise<string>,
  onRevoked: () => void,
  use: (relay: RelayConnection) => Promise<void>,
) {
  const relay = new RelayConnection({ url, port, proof, onRevoked, onChange: () => {} });
  relay.start(); // void begins asynchronous dialing, not ready receipt.
  try {
    await use(relay);
    relay.dropStreams();
    relay.reconnect();
    return relay.status();
  } finally {
    relay.close();
  } // Sync permanent socket/exchanges/retries teardown; cannot restart.
  // dial?/timing? defaults; no null. onChange notification, no subscribe/disposer method.
}

// INTERNAL/HOST-ONLY account serving: main/connect-runtime.ts:133-145,298-583.
async function currentConnectRuntime(
  options: ConnectRuntimeOptions,
  share: ConnectShare,
  use: (runtime: ConnectRuntime) => Promise<void>,
) {
  const runtime = new ConnectRuntime(options); // config and account REQUIRED T|undefined, never null.
  try {
    await runtime.autostart(share); // Restores persisted toggle only, no prompts.
    await runtime.openAccount();
    const linked = await runtime.link(); // Promise<ConnectView>.
    if (linked.kind !== "linked") return linked;
    await runtime.setEnabled({ enabled: true, share }); // Owns listener+relay+lease heartbeat.
    runtime.accountChanged();
    runtime.resume();
    await use(runtime);
    return await runtime.view();
  } finally {
    await runtime.close();
  } // Keeps persisted link/devices/toggle; closes account too.
}

async function currentConnectAdministration(
  runtime: ConnectRuntime,
  share: ConnectShare,
  deviceId: string,
) {
  await runtime.cancel();
  await runtime.revokeDevice({ deviceId }); // Pending link/device only.
  await runtime.signOut(); // Account sign-out does NOT unlink machine or disable serving.
  await runtime.setEnabled({ enabled: false, share });
  await runtime.unlink(); // Explicit removal.
}

// INTERNAL/HOST-ONLY cloudflared: main/cloudflared.ts:186-248,301-347; cloudflare-tunnel.ts:298-330.
async function currentCloudflared(
  tunnelToken: string,
  hostname: string,
  port: number,
  directory: string,
  use: (connector: CloudflaredConnector) => Promise<void>,
) {
  const executable = await findCloudflared();
  if (executable === undefined) return; // Unavailable, not null.
  await prepareConnectorDirectory(directory);
  const connector = new CloudflaredConnector({
    executable,
    tunnelToken,
    hostname,
    port,
    directory,
    onChange: () => {},
  });
  connector.start(); // void, supervised asynchronous readiness/retry; timing? defaults.
  try {
    await use(connector);
    return connector.status();
  } finally {
    await connector.stop();
  } // Process+supervisor gone or kill deadline; no close/subscribe.
}

// INTERNAL/HOST-ONLY Electron account: main/account.ts:23-30,225-258; account-session.ts:12-38.
async function currentRegisteredAccount(
  options: Parameters<typeof registerAccount>[0],
  signal: AbortSignal,
  useToken: (token: string) => Promise<void>,
) {
  const account = registerAccount(options); // Registers IPC+app listeners once per app lifetime.
  try {
    account.focus();
    await useToken(await account.requestSessionToken({ signal }));
    return account.state();
  } finally {
    await account.close();
  } // Rejects pending operations; does NOT unregister IPC/Clerk.
  // store REQUIRED AccountStore|undefined; window(id?:number) may return undefined.
  // account.signOut():Promise<void> is explicit credential removal, separate from close.
  // Actual Clerk bridge cleanup is app will-quit; never register again for each token request.
}

async function currentAccountSignOut(account: AccountSession) {
  await account.signOut();
} // Doesn't unlink machine.

// Remote exposure

// INTERNAL/HOST-ONLY: packages/desktop/src/main/remote-access-plugin.ts:17-54;
// packages/desktop/src/main/cloudflare-tunnel.ts:65-72,137-150.
// Public listener dependency: @nyte-ai/serve startServe(options:ServeOptions):Promise<Serving>.
// packages/serve/src/index.ts:19-24,84-94; packages/server/src/node.ts:24-48.
// Plugin owns settings/device digests/connector. Host owns trusted SDK/share cursor/listener.
// Registration: packages/desktop/src/main/index.ts:203; not a discoverable core SDK plugin.

/**
 * options: home:string REQUIRED; cloudflared?:string, pairingWindowMs?:number, timing?:ConnectorTiming.
 * Omitted executable searches install paths; omitted pairingWindowMs = 10 minutes; null invalid.
 */
async function currentCloudflareExposure(
  options: CloudflareTunnelOptions,
  settings: CloudflareTunnelSettings,
  sdk: Nyte,
  environment: Environment,
  attach: (sessionId: SessionId) => void,
  changed: () => void,
  use: (
    plugin: CloudflareTunnelPlugin,
    exposure: RemoteExposure,
    listener: Serving,
  ) => Promise<void>,
) {
  const plugin = new CloudflareTunnelPlugin(options); // No close/dispose/subscribe on this class.
  // settings: hostname:string, port:number, tunnelToken:string; all REQUIRED, no null reset.
  await plugin.configure(settings); // Promise<void>, not plugin/this. Refused while exposed.
  // Validated hostname alone, port integer 1024..65535, valid dashboard token; throws ExpectedHostError.
  // Same hostname preserves devices; changing hostname forgets all. Token never appears in view().
  const initial = await plugin.view(); // Promise<CloudflareTunnelView>, secret-free data, not a handle.
  const exposure = await plugin.expose(changed); // Acquires reservation; connector NOT started yet.
  // address:string; listen:{port:number,auth:ServerAuth,browserOrigins:readonly string[],handle?}.
  // handle?:(request:Request)=>Promise<Response|undefined>; omit/fallthrough undefined, NEVER null.
  // Cloudflare leaves handle absent. Custom routes precede Nyte auth and must authorize themselves.
  let listener: Serving | undefined;
  try {
    listener = await startServe({
      sdk,
      environment,
      version: "dev",
      hostname: "127.0.0.1",
      ...exposure.listen,
      attach,
    });
    // Host caller supplies trusted scoped SDK/environment. No session cwd or runner is invented here.
    exposure.connect(); // void; only AFTER successful bind. Starts async supervised connection.
    await use(plugin, exposure, listener); // Harness callback can observe readiness and pair below.
    return { initial, current: await plugin.view(), address: exposure.address };
  } finally {
    try {
      await exposure.disconnect();
    } // Connector first.
    finally {
      await listener?.close();
    } // Port still closes if disconnect fails.
    // Listener close drops streams/watches; accepted SDK work continues. Caller owns SDK/environment.
  }
  // Native caller order/rollback: packages/desktop/src/main/host.ts:3030-3087,3094-3105.
  // expose/connect/view aren't fluent. While reserved, configure/clear/another expose are refused.
}

// INTERNAL pair():Promise<RemotePairing>.
// packages/desktop/src/main/cloudflare-tunnel.ts:205-261; packages/app/src/bridge.ts:244-251.
async function currentExposurePair(plugin: CloudflareTunnelPlugin, name: string) {
  const view = await plugin.view();
  if (view.kind !== "configured" || view.connection.kind !== "connected") return view;
  // This read isn't a lock: pair rechecks exposure AND connector readiness, and may throw.
  const paired = await plugin.pair({ name }); // Exact input {readonly name:string}, not deviceId.
  // paired: deviceId:string, address:string, token:string, expiresAt:number; all REQUIRED.
  // Return token once to the device, not logs/history; only its SHA-256 digest is persisted.
  // Name trimmed 1..64 chars; <=20 live devices total, <=5 pending. Unused tokens expire.
  return paired; // No paired.close; device credential and exposure have different lifetimes.
}

// INTERNAL auth THROUGH acquired ServerAuth, not a public plugin.authorize method.
// packages/server/src/index.ts:60-81; packages/desktop/src/main/cloudflare-tunnel.ts:342-391.
// Digest/persistence: packages/desktop/src/main/cloudflare-tunnel-store.ts:3-10,111-139.
async function currentExposureAuth(exposure: RemoteExposure, request: Request) {
  const auth = exposure.listen.auth;
  if (auth.kind !== "custom") return; // ServerAuth also admits token, but Cloudflare uses custom.
  return await auth.authorize(request); // Declared return unknown; server validates AuthDecision.
  // Cloudflare actual value: {kind:"allow"}|{kind:"deny",reason:"unauthorized"|"forbidden"}.
  // Missing/malformed Bearer -> unauthorized; wrong/expired/revoked/store-failed -> forbidden.
  // First valid pending token is atomically persisted as paired before allow; then changed() fires.
  // Request.headers.get may yield null; bearer normalizes absence to undefined. No null auth result.
  // Paired token remains valid across connector/desktop restarts until revoked/settings removed.
}

// Host revocation MUST end pre-authorized streams: packages/desktop/src/main/host.ts:3114-3134.
// Plugin method: packages/desktop/src/main/cloudflare-tunnel.ts:263-273.
async function currentExposureRevoke(
  plugin: CloudflareTunnelPlugin,
  exposure: RemoteExposure,
  listener: Serving,
  deviceId: string,
) {
  try {
    await plugin.revoke({ deviceId });
  } // Promise<void>; absent device is a no-op.
  catch (cause) {
    // Sticky store failure refuses tokens; host stops sharing on failed revoke.
    const cleanup = await Promise.allSettled([exposure.disconnect(), listener.close()]);
    const failures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    throw new AggregateError([cause, ...failures], "Revoke and shutdown failed");
  }
  listener.disconnectClients(); // void, ALL clients/streams; port+connector stay, others reauthenticate.
  // Plugin.revoke alone changes credential acceptance, not listener lifetime or already-open SSE.
}

// INTERNAL explicit credential/settings deletion, separate from stopping a listener.
// packages/desktop/src/main/cloudflare-tunnel.ts:200-203,400-405;
// packages/desktop/src/main/cloudflare-tunnel-store.ts:65-67,111-139,174-181.
async function currentExposureClear(plugin: CloudflareTunnelPlugin) {
  await plugin.clear(); // Promise<void>; only AFTER disconnect, removes settings AND devices.
  return plugin.view(); // unconfigured if readable; unavailable if sticky store failure.
  // Store missing file uses undefined, not null. Failed read/write stays failed until restart.
  // onChange callback isn't a subscription handle. Stop/disconnect doesn't clear paired credentials.
}

// Telemetry, TUI and enrollment

/**
 * PUBLIC @nyte-ai/telemetry: src/index.ts:18–30; memory.ts:30–38.
 */
async function currentExtraTelemetry(tracer: Tracer) {
  const memory = new InMemoryTelemetryContext(); // S, no arguments, no close/shutdown.
  const value = await memory.startSpan(
    { name: "sdk-demo", attributes: { enabled: true, omitted: undefined } },
    async (span) => {
      span.setAttributes({ count: 1 }); // V merges defined scalars; undefined ignored.
      span.addEvent("admitted"); // V, optional attributes; NOT nullable.
      span.addEvent("boundary", { attempt: 1 });
      span.setStatus({ status: "ok" }); // V; only ok/error, last explicit call wins.
      return span.startSpan({ name: "child" }, () => "result"); // A→callback value.
    },
  );
  const spansResult = memory.spans(); // spans() S readonly RecordedSpan[], start order.
  // RecordedSpan.parentId is number|undefined, not null; deterministic IDs/no timestamps.
  const ended = await memory.startSpan({ name: "ended" }, (span) => span);
  ended.addEvent("ignored"); // post-settlement mutation ignored.
  await ended.startSpan({ name: "unrecorded" }, () => undefined); // callback still runs.
  await NOOP_TELEMETRY_CONTEXT.startSpan({ name: "noop" }, () => businessValue);
  // startSpan ALWAYS A, callback invoked synchronously once; return/rejection preserved.
  // Attributes are string|number|boolean|undefined, not arbitrary objects or null.
  // PUBLIC @nyte-ai/telemetry/otel: src/otel.ts:25.
  const telemetry = createOtelTelemetry(tracer); // S→TelemetryContext, no owned exporter.
  const startSpanResult = await telemetry.startSpan({ name: "otel-demo" }, (span) =>
    span.startSpan({ name: "explicit-child" }, businessCallback),
  );
  // Adapter recording failures swallowed; span ends on callback settlement, not manual close.
  // No adapter.shutdown(); host owns supplied tracer/provider/processor/exporter.
  // PUBLIC host/otel.ts:28 provides DIFFERENT owned exporter composition:
  const owned = createOtelExport({ serviceName: "sdk-spec", endpoint: tracesUrl }); // S.
  try {
    await owned.telemetry.startSpan({ name: "owned-export" }, businessCallback);
  } finally {
    await owned.shutdown();
  } // A flush AFTER SDK/host close in real composition.
  // endpoint? omitted uses NYTE_OTEL_ENDPOINT; empty disables; null is not accepted.
  // All span mutators V, spans() data, startSpan result data: no fluent chaining.
}

/**
 * INTERNAL TUI module exports, NOT package export subpaths. plugin-loader.ts:98,125.
 * Actual name is createBunPluginSources(); there is NO BunPluginSources class.
 */
async function currentExtraBunSources() {
  const prepare = bunPluginLoader(hostModules); // S→Prepare<unknown>, not loaded plugin.
  const prepared = await prepare(pluginEntry, trackPluginSource, sourceInstance); // Prepare may S/A.
  const loadResult = await prepared.load(); // A→unknown module; raw loader is not validated Plugin.
  // Registers Bun host-module hook once, evicts local graph, shares node_modules.
  // Distinct from host nodePluginLoader; no returned unregister for process-wide Bun hook.
  const sources = createBunPluginSources(); // S→PluginSources<unknown>, no options/null.
  try {
    const sourcesValue = await sources.read(pluginEntry); // A→{version,value}; cache/revalidation.
    sources.retain(new Set([pluginEntry])); // V prunes cache, NOT disposer or refcount.
    sources.invalidate(); // V; next read reevaluates source identity.
  } finally {
    sources.dispose();
  } // V clears cache AND closes owned source watcher.
  // Unlike generic createPluginSources, this opener owns/disposes its watcher too.
  // Loader/prepared/sources are nonfluent; no sources.close(), ready(), or SDK ownership.
}

/**
 * INTERNAL product Host; packages/tui/src/host.ts:29,57,94,103,114.
 * OpenHostOptions: Omit<HostOptions,"store"> + cwd,storePath,watchPollIntervalMs?.
 * HostOptions requires models/model/plugins; no supplied store/defaultWorkspace/streamFn.
 */
async function currentExtraTuiHost(options: Parameters<typeof Host.open>[0]) {
  const host = await Host.open(options); // A→Host; constructor private, no new Host().
  // Owns WorkerStore + ready, createBunPluginSources, createHost/Nyte.
  // Workspace plugins get owned sources + default codemode options; partial failure cleans up.
  try {
    const session = await host.nyte.sessions.create({ name: "Owned TUI demo" });
    const release = host.attach(session.sessionId); // S→D; children follow, NOT durable Stop.
    try {
      const sessionWorkspaceResult = await host.nyte.sessionWorkspace({
        sessionId: session.sessionId,
      });
    } finally {
      release();
    }
    const cwd = host.cwd;
    const storePath = host.storePath;
    const store = host.store;
    const pluginSources = host.pluginSources;
    const sessionCommitsResult = await host.sessionCommits(session.sessionId); // A retained all-branch commits.
    // Opens/closes a borrowed session handle; full /tree projection in workbench demos above.
  } finally {
    const outcome = await host.close(); // A→closed | failed{failures:[{resource,cause}]}.
    // Best-effort SDK→plugins→store; failures are VALUES, not thrown causes.
    const hostCloseOutcome = await host.close(); // same cached settlement, idempotent.
  }
  // Optional poll interval omitted = store default; no null option fields.
  // Host.open/options are nonfluent; close is not Promise<void>; no automatic attach on open.
}

/**
 * INTERNAL product module app/src/web/account-connection.ts:23,60–83.
 * Distinct orchestrator, not createBrokerClient or low-level awaitAcceptance.
 */
async function currentExtraWebManagedEnrollment() {
  const device = await connectAccountEnvironment({
    broker,
    config: accountConfig,
    ownerId,
    environment: environmentSummary,
    signal,
  }); // A→AccountDevice|undefined.
  // ALL input fields required, none nullable; undefined return = cancellation, not null.
  // Owns secret/enroll/readiness/webBridge.connect({relay:true})/sessionStorage save.
  // If bridge connect OR saveAccountDevice throws, finally schedules releaseAccountDevice.
  // Unkept bearer release is fire-and-forget, NOT awaited or confirmed before rejection.
  if (device === undefined) return;
  const environmentId = device.environmentId;
  const deviceId = device.deviceId; // retained ownership now belongs to product.
  // account-connection.ts:86,94,109: separate weak release versus strong revoke.
  const releaseAccountDeviceResult = await releaseAccountDevice(device); // A→removed|unconfirmed, keepalive fetch.
  await revokeAccountDevice(device, broker); // A→void; broker revoke then host release.
  await releaseStoredAccountDevice(undefined); // required argument allows undefined, NOT null.
  // Above clears stored row even without config; does not revoke a device it cannot identify.
  // No fluent connect chain or returned client.close(); sessionStorage isn't server-enforced tab TTL.
}

/**
 * INTERNAL product mobile/src/account/enrollment.ts:42,93–116; connection-store.ts:26.
 */
async function currentExtraMobileManagedEnrollment() {
  const ending = await connectEnvironment({
    broker,
    environment: environmentSummary,
    origin: connectOrigin,
    ownerId,
    clientId,
    clientName,
    crypto: deviceCrypto,
    fetch: injectedFetch,
    save: connectionStore.save,
    signal,
  }); // A→ConnectEnding.
  // connected/broker/notAccepted/silent/notSaved/cancelled; can reject too.
  // readiness?:typeof READINESS omitted defaults; NOT null. Every other input required.
  // SaveResult.saved.replaced is SavedConnection|undefined, not null; callbacks are A.
  const notSaved = await connectEnvironment({
    broker,
    environment: environmentSummary,
    origin: connectOrigin,
    ownerId,
    clientId,
    clientName,
    crypto: deviceCrypto,
    fetch: injectedFetch,
    signal,
    save: async () => ({ kind: "failed" }),
  });
  // accepted + failed persistence→notSaved; schedules weak host release.
  // Cancellation result also discards; saved result releases replaced managed bearer (V).
  // Unlike web finally, arbitrary save callback rejection has NO discard finally here.
  // Product ConnectionStore.save converts write/rollback failures to failed outcomes;
  // a failed rollback may leave disk unknown: notSaved does NOT promise nothing persisted.
  // Unexpected throws classified by account-provider.tsx:313–332, not this low-level function.
  // mobile/account/revocation.ts:48: teardown is separate from connect, ownership explicit.
  const releaseDeviceResult = await releaseDevice({
    saved: managedSavedConnection,
    broker,
    fetch: injectedFetch,
    timeoutMs: RELEASE_TIMEOUT_MS,
  }); // A host/broker report.
  // broker:BrokerClient|undefined required field; undefined skips broker, NOT null.
  // No app model runner/store creation or socket opener; all returns nonchainable data.
}

// Part II. Proposed contracts, not implemented

/**
 * Core owns commands, admission, recovery, projection and authorization.
 * The harness supplies storage, model execution, environments, tools and policy.
 * Clients own transport and the pre-receipt journal; views paint data.
 *
 * Use native TypeScript functions, Promises and explicit resource owners.
 * Expected failures return Result<Success, Failure>. Dependencies are ordinary
 * typed parameters where an implementation needs them; there is no required
 * generic handler wrapper, runtime service registry or lazy computation system.
 * Domain schemas define the same operation contract for local, IPC and HTTP calls.
 *
 * API vocabulary
 *   session/head/run/job/workspace/page(id)   S: bind identity, no I/O.
 *   open/connect/create                     A: acquire/create, await first.
 *   steer/queue                             O: host admission, not an answer.
 *   branch                                  O: create a named conversation head.
 *   navigate/edit                           O: admit a durable history operation.
 *   markSeen                                O: forward-only reader mark, not history.
 *   observe/events/bytes                    W: observe; never acquire execution.
 *   stop/withdraw/destroy                   O: explicit durable/lifecycle command.
 *   close/asyncDispose                      A: release exactly the acquired owner.
 *
 * Callers need no observer, outbox, lease or global workspace selection.
 * open/connect permanently binds addresses to the authenticated host. UI
 * selection cannot retarget existing handles or queued requests to another host.
 */

// 1. Usage. All consumers use the same contract.

async function proposedLocalCi(options: HostOpenOptions, task: UserContent, choice: ChoicePatch) {
  const hostResult = await Nyte.open(options);
  if (!hostResult.ok) return hostResult;
  await using host = hostResult.value; // A owned host, no implicit runner.
  const sdk = host.sdk;
  const sessionResult = await sdk.sessions.create({ name: "CI review" });
  if (!sessionResult.ok) return sessionResult;
  const session = sessionResult.value;
  const executionResult = await host.execution.cover({ kind: "sessions", sessions: [session.id] });
  if (!executionResult.ok) return executionResult;
  await using execution = executionResult.value;
  // session is the main-head handle plus session operations. No mandatory .head("main").
  const receiptResult = await session.queue(task, { configuration: choice });
  if (!receiptResult.ok) return receiptResult;
  const receipt = receiptResult.value;
  const landingResult = await receipt.landing();
  if (!landingResult.ok) return landingResult;
  const landing = landingResult.value; // Await placement, not generation.
  if (landing.kind !== "landed") return landingResult;
  const run = session.run(landing.runId); // S, exact run. Several inputs may share it.
  const endResult = await run.settled({ signal: AbortSignal.timeout(30 * 60_000) });
  if (!endResult.ok) return endResult;
  const end = endResult.value;
  return { ok: true, value: { receipt: receipt.record, end } } as const;
  // Timeout cancels only this wait. CI cancellation may explicitly run.stop().
  // Releasing the host stops local driving and closes owned resources, not durable Stop.
}

async function proposedRemoteCi(
  connection: ConnectOptions,
  sessionId: SessionId,
  content: UserContent,
) {
  const connectedResult = await Nyte.connect(connection);
  if (!connectedResult.ok) return connectedResult;
  await using connected = connectedResult.value; // A handshake + owned client.
  const sdk = connected.sdk;
  const main = sdk.session(sessionId); // S: no existence check, no execution claim.
  const revisionResult = await main.view();
  if (!revisionResult.ok) return revisionResult;
  const revision = revisionResult.value; // O: addressed lookup can return missing.
  const branchResult = await main.branch({
    name: "ci-review",
    from: revision.position,
    key: sdk.keys.command(),
  });
  if (!branchResult.ok) return branchResult;
  const branch = branchResult.value;
  if (branch.kind !== "created") return branchResult;
  const receiptResult = await branch.head.queue(content, { key: sdk.keys.submission() });
  if (!receiptResult.ok) return receiptResult;
  const receipt = receiptResult.value;
  if (receipt.record.execution === "uncovered")
    return { ok: true, value: { kind: "uncovered", receipt: receipt.record } } as const;
  const placementResult = await receipt.landing();
  if (!placementResult.ok) return placementResult;
  const placement = placementResult.value;
  if (placement.kind === "landed") {
    const run = branch.head.run(placement.runId);
    return await run.settled(); // Await before connected scope disposal.
  }
  return placementResult;
}

async function proposedDesktopOrTui(sdk: Sdk, sessionId: SessionId, ui: ConversationUi) {
  const main = sdk.session(sessionId);
  const viewResult = await main.observe();
  if (!viewResult.ok) return viewResult;
  await using view = viewResult.value; // A owned subscription; stable snapshots.
  const unsubscribe = view.subscribe(() => ui.paint(view.getSnapshot()));
  try {
    ui.paint(view.getSnapshot()); // Both desktop and TUI consume the same read model.
    const choice = ui.selectedConfiguration(); // Capture values at Enter, before preparation.
    const shown = view.getSnapshot();
    if (shown.kind !== "ready") return;
    const content = await ui.prepareContent(); // Later navigation cannot retarget this input.
    const sentResult = await main.steer(content, {
      configuration: choice,
      history: shown.value.history,
    });
    if (!sentResult.ok) return sentResult;
    const sent = sentResult.value;
    // Resolves at host receipt; local acknowledgement uses deliveries below.
    ui.clearDraftAfterAdmission(sent.record);
    await ui.untilClosed();
  } finally {
    unsubscribe();
  }
  // Configuration is submitted with the input; observation does not drive execution.
}

async function proposedTreePicker(sdk: Sdk, id: SessionId, picker: ConversationTreeUi) {
  const main = sdk.session(id);
  const graphResult = await main.tree();
  if (!graphResult.ok) return graphResult;
  await using graph = graphResult.value; // A pinned retained graph, not transcript-only.
  for await (const pageResult of graph.pages()) {
    if (!pageResult.ok) return pageResult;
    const page = pageResult.value;
    picker.add(page);
  }
  const selected = await picker.select(); // start | commit, not null.
  if (selected.kind === "dismissed") return;
  const retainedResult = await graph.renew();
  if (!retainedResult.ok) return retainedResult;
  const retained = retainedResult.value;
  if (retained.kind === "expired")
    return { ok: false, error: { kind: "snapshot-expired" } } as const;
  const operationResult = await main.navigate({
    key: sdk.keys.command(),
    selection: selected.position,
    expect: graph.revision,
    abandoned: { kind: "summarize", instructions: "Keep conclusions and paths" },
    running: { kind: "refuse" },
  });
  if (!operationResult.ok) return operationResult;
  const operation = operationResult.value;
  const outcomeResult = await operation.settled();
  if (!outcomeResult.ok) return outcomeResult;
  const outcome = outcomeResult.value;
  if (outcome.kind === "navigated" && outcome.handback.kind === "message") {
    picker.offerDraftAfterRevision(outcome.revision, outcome.handback.content);
  }
  // Core selects a user commit's parent and returns its content. UI must not
  // overwrite a newer draft. Graph close releases the pin, not heads or commits.
  return outcomeResult;
}

async function proposedEdit(
  sdk: Sdk,
  id: SessionId,
  shown: SessionView,
  edited: UserContent,
  message: CommitId,
) {
  const main = sdk.session(id);
  const running: NavigationRunning =
    shown.execution.kind === "live"
      ? { kind: "stop", runId: shown.execution.run.id }
      : { kind: "refuse" };
  const operationResult = await main.edit({
    key: sdk.keys.command(),
    message,
    expect: shown.revision,
    running,
    replacement: {
      content: edited,
      ...(shown.configuration.selected === null
        ? {}
        : { configuration: shown.configuration.selected }),
    },
  });
  if (!operationResult.ok) return operationResult;
  const operation = operationResult.value;
  // Core stops the exact run, awaits settlement, revalidates, then publishes
  // move+input. It never looks up "current" to stop it or stops a replacement run.
  return operation.settled();
}

async function proposedReturnToPlace(
  sdk: Sdk,
  id: SessionId,
  screen: TranscriptScreen,
  anchors: Map<HeadName, ScrollAnchor>,
) {
  const main = sdk.session(id);
  const viewResult = await main.observe();
  if (!viewResult.ok) return viewResult;
  await using view = viewResult.value; // A; the same read model as proposedDesktopOrTui.
  const opened = view.getSnapshot();
  if (opened.kind !== "ready") return;
  const divider = opened.value.unseen; // Frozen for this visit. Later marks never move it.
  const unsubscribe = view.subscribe(() => screen.paint(view.getSnapshot(), { divider }));
  screen.paint(opened, { divider });
  screen.scrollTo(
    anchors.get(main.name) ??
      (divider === null ? { kind: "bottom" } : { kind: "commit", commit: divider, offsetPx: 0 }),
  );
  const stopMarking = screen.onDurableContentShown(async (commit) => {
    const marked = await main.markSeen({ kind: "commit", id: commit });
    if (!marked.ok) screen.reportFailure(marked.error);
  });
  // Mark only TurnPartView commits shown in a visible, focused window; coalesce per head.
  try {
    await screen.untilClosed();
  } finally {
    stopMarking();
    unsubscribe();
    anchors.set(main.name, screen.anchor());
  }
  // Divider and anchor are view memory for one window. Core keeps only the seen mark.
  // A second device marking further ahead changes the sidebar dot here, not this divider.
}

// A future React useSession adapter binds sdk.session(id).observe through
// useSyncExternalStore. Core owns admission, retry identity, queue policy,
// branches and execution. This contract needs no separate hooks package.

// 2. Values. Derive these types from one canonical domain schema.
// Use the existing schema library as the source of truth for inputs, outcomes
// and failures. Requirements are local dependencies, never serialized services.

// Expected operation failures are values. Defects and cleanup exceptions reject.
// Result uses the existing core/kernel/result.ts discriminant, not a new runtime.
type Result<Success, Failure> =
  | { readonly ok: true; readonly value: Success }
  | { readonly ok: false; readonly error: Failure };

// All public failure records are schema-derived and safe to cross IPC/HTTP.
// A failure names what failed and preserves the recovery identity when work may
// have started. Host logs keep private causes under correlation, not wire stacks.
type ValidationIssue = {
  readonly severity: "error" | "warning";
  readonly path: readonly (string | number)[]; // JSON pointer segments into the input or declaration.
  readonly message: string;
  readonly source?: { readonly plugin: string; readonly file?: string; readonly line?: number };
};
// One issue shape for request validation and plugin/declaration checks. source
// names the plugin and, for loaded files, file:line, so a report reads
// "error user/keys.ts:12 commands.add: duplicate name". A warning never
// rejects; an error rejects exactly the declaration or request it points at.
type SdkFailure =
  | { readonly kind: "invalid-input"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unauthenticated"; readonly reason: string }
  | { readonly kind: "denied"; readonly operation: string; readonly reason: string }
  | { readonly kind: "missing"; readonly resource: string }
  | { readonly kind: "unavailable"; readonly capability: string; readonly reason: string }
  | { readonly kind: "key-conflict"; readonly identity: WriteIdentity }
  | { readonly kind: "snapshot-expired" }
  | { readonly kind: "configuration-rejected"; readonly reason: string }
  | {
      readonly kind: "history-changed";
      readonly expected: HistoryEpoch;
      readonly current: HistoryEpoch;
      readonly key: SubmissionKey;
    }
  | { readonly kind: "transport"; readonly attempt: TransportAttempt; readonly message: string }
  | { readonly kind: "closed"; readonly attempt: RequestAttempt }
  | { readonly kind: "request-aborted"; readonly attempt: RequestAttempt }
  | {
      readonly kind: "io";
      readonly operation: string;
      readonly message: string;
      readonly attempt: RequestAttempt;
      readonly correlation: string;
    }
  | { readonly kind: "capacity"; readonly resource: string; readonly limit: number }
  | { readonly kind: "internal"; readonly correlation: string; readonly attempt: RequestAttempt };

type RequestFailure = Extract<
  SdkFailure,
  {
    readonly kind:
      | "invalid-input"
      | "unauthenticated"
      | "denied"
      | "missing"
      | "unavailable"
      | "transport"
      | "closed"
      | "request-aborted"
      | "io"
      | "internal";
  }
>;
type MutationFailure = RequestFailure | Extract<SdkFailure, { readonly kind: "key-conflict" }>;
type AdmissionFailure =
  | MutationFailure
  | Extract<
      SdkFailure,
      {
        readonly kind: "configuration-rejected" | "history-changed";
      }
    >;
type ConfigurationFailure =
  | MutationFailure
  | Extract<SdkFailure, { readonly kind: "configuration-rejected" }>;
type HistoryFailure =
  | RequestFailure
  | Extract<SdkFailure, { readonly kind: "snapshot-expired" | "capacity" }>;
type CommandFailure =
  | MutationFailure
  | Extract<SdkFailure, { readonly kind: "configuration-rejected" | "capacity" }>;
type ResourceOpenFailure = MutationFailure | Extract<SdkFailure, { readonly kind: "capacity" }>;
type JournalFailure = Extract<
  SdkFailure,
  { readonly kind: "invalid-input" | "io" | "closed" | "capacity" | "history-changed" }
>;
type HostOpenFailure =
  | ResourceOpenFailure
  | Extract<SdkFailure, { readonly kind: "configuration-rejected" }>;
type ConnectionFailure = ResourceOpenFailure;

// These named unions are the readable view of operation.failure schemas. A
// generated method uses its declared subset; adding a failure changes its type.
// Conflicts, busy, partial writes and run failure remain domain outcomes when
// the requested operation successfully determines that outcome. The Result
// error branch means the request could not produce its declared outcome.
// Runtime requirements, such as workspace trust, remain WorkspaceActivation
// data. They are not missing TypeScript dependencies.
//
// Validate inputs, declared dependencies, permissions and known expectations
// before opening resources, stopping runs, charging a provider or mutating files.
// Check authoritative state again at publication. Preflight is not a lock.
// Unknown writes never become confirmed failures: preserve their identity and
// reconcile before retry. Never catch every exception and invent a domain result.
// Local implementation defects reject as unknown; a remote boundary redacts
// those defects to internal with correlation and publication certainty.
//
// Streams yield Result<Frame, Failure>. An expected terminal failure is yielded
// once, then the stream ends and releases its reader. End without error is normal
// completion; return() detaches observation. Recovery/gap frames remain data.
// Unexpected iterator defects reject. Owned.close/asyncDispose are the deliberate
// cleanup exception: both reject AggregateError after attempting every finalizer,
// so await using cannot silently discard a failed cleanup Result.

type WriteIdentity = { readonly host: HostId; readonly principal: PrincipalId } & (
  | {
      readonly kind: "input";
      readonly session: SessionId;
      readonly head: HeadName;
      readonly key: SubmissionKey;
    }
  | { readonly kind: "command"; readonly key: CommandKey }
  | { readonly kind: "create-session"; readonly session: SessionId }
  | { readonly kind: "acquisition"; readonly workspace: WorkspaceId; readonly key: AcquisitionKey }
  | { readonly kind: "convergent"; readonly target: DomainStateAddress }
  | { readonly kind: "volatile"; readonly target: RuntimeResourceAddress; readonly attempt: string }
);
type TransportAttempt =
  | { readonly kind: "read"; readonly retry: "read-only" | "manual" }
  | { readonly kind: "not-attempted"; readonly identity: null; readonly retry: "manual" }
  | {
      readonly kind: "not-attempted" | "unknown";
      readonly identity: Exclude<WriteIdentity, { readonly kind: "volatile" }>;
      readonly retry: "same-key" | "manual";
    }
  | {
      readonly kind: "not-attempted" | "unknown";
      readonly identity: Extract<WriteIdentity, { readonly kind: "volatile" }>;
      readonly retry: "manual";
    };
// Same-key retry requires an identity and excludes volatile actions.
type RequestAttempt =
  | { readonly kind: "read" }
  | { readonly kind: "not-attempted"; readonly identity: WriteIdentity | null }
  | { readonly kind: "unknown"; readonly identity: WriteIdentity };

type Id<Name extends string> = string & { readonly __brand: Name };
type SessionId = Id<"session">;
type HeadName = Id<"head">;
type CommitId = Id<"conversation-commit">;
type InputChangeId = Id<"input-change">;
type RunId = Id<"run">;
type CallId = Id<"tool-call">;
type WaitId = Id<"wait-generation">;
type SubmissionKey = Id<"submission-key">;
type CommandKey = Id<"command-key">;
type WorkspaceId = Id<"workspace">;
type HostId = Id<"authenticated-host">;
type PrincipalId = Id<"authenticated-principal">;
type EnvironmentId = Id<"execution-environment">;
type PageId = Id<"browser-page">;
type TerminalId = Id<"terminal">;
type JobId = Id<"job">;
type FileVersion = Id<"file-version">;
type FileSnapshotId = Id<"workspace-file-snapshot">;
type GitCommitId = Id<"git-commit">;
type GitRevision = Id<"git-working-state">;
type BranchRevision = Id<"branch-view-revision">;
type HistoryEpoch = Id<"history-generation">;
type SideHeadName = HeadName & { readonly __side: true };
type AcquisitionKey = Id<"resource-acquisition">;
type DocumentRevision = Id<"browser-document-revision">;
type Cursor = Id<"cursor">;
type BlobId = Id<"blob">;
type Seq = number & { readonly __brand: "session-sequence" };
type Json = null | boolean | number | string | readonly Json[] | { readonly [name: string]: Json };

type UserContent =
  | string
  | readonly (
      | { readonly kind: "text"; readonly text: string }
      | { readonly kind: "image"; readonly blob: BlobId; readonly mime: string }
    )[];
// Blob storage owns uploaded bytes. A blob reference never exposes a local path.
// Conversation commits, file snapshots, Git objects and page IDs cannot substitute.

type Lookup<T> = { readonly kind: "found"; readonly value: T } | { readonly kind: "missing" };
type Page<T> = { readonly items: readonly T[]; readonly next: Cursor | null };
// next:null means known end. Omitted cursor in a request means first page.

type Position = { readonly kind: "start" } | { readonly kind: "commit"; readonly id: CommitId };
type ParentFilter =
  | { readonly kind: "all" }
  | { readonly kind: "roots" }
  | { readonly kind: "children"; readonly session: SessionId };
type QueuePosition =
  | { readonly kind: "last" }
  | { readonly kind: "before"; readonly key: SubmissionKey };
type Capability<T> =
  | { readonly kind: "available"; readonly value: T }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly retry: "allowed" | "manual"; readonly reason: string };
// Capability reports permission/provision, not file/session/page existence.
// An available handle still rechecks revocation at every external boundary.

type RequestOptions = { readonly signal?: AbortSignal };
// signal omission = no caller-supplied interruption. null rejected.
// Abort stops this request/wait. A submitted write may already have committed.

interface Owned {
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
// Both methods perform the same idempotent release. Close rejects new calls,
// settles accepted local cleanup, tries every finalizer and reports aggregate
// failures. It never silently deletes data.

type ModelRef = { readonly provider: string; readonly id: string };
type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ChoicePatch = {
  readonly kind: "patch"; // Required discriminant; nullable fields are clear commands.
  readonly model?: ModelRef;
  readonly thinking?: Thinking | null;
  readonly agent?: string | null;
  readonly requestPolicy?: RequestPolicyPatch;
};
// model omitted -> retain/capture branch model; null model is invalid.
// thinking/agent omitted -> retain/capture selected value.
// thinking:null / agent:null -> clear override, resolve host/agent default at admission.
// The receipt contains the resolved choice, never an unresolved default callback.
interface RequestPolicyPatch {
  readonly fast?: boolean | null; // omitted keep; null reset to provider default.
  readonly settings?: Readonly<Record<string, Json>>; // omitted keep; validated per registered policy.
}
interface ResolvedChoice {
  readonly kind: "exact"; // Required discriminant; values, not clear commands.
  readonly model: ModelRef;
  readonly thinking: Thinking;
  readonly agent: string | null; // null = explicitly the built-in agent, not current defaults.
  readonly requestPolicy: {
    readonly fast: boolean;
    readonly settings: Readonly<Record<string, Json>>;
    readonly definitionVersion: string;
  };
}
type InputChoice = ChoicePatch | ResolvedChoice;
// Exact choice preserves model/thinking/agent and the full request-policy
// definitionVersion. Reject unusable versions; do not drop them or re-resolve
// defaults. Exact agent:null is a value, not patch agent:null's reset command.
// The disjoint union rejects that conversion. configure accepts only kind:patch;
// submission/edit also accept kind:exact.
// For example: queue(text, {configuration:{kind:"patch",model:{provider,id}}}).
// Admission resolves request-affecting plugin settings, includes them in the
// request digest/compatibility comparison and passes them to before_request.
// Fast-mode hooks use captured policy, not current settings. UI-only preferences
// stay outside input choice. Unsupported fast mode is configuration-rejected,
// never silently upgraded or downgraded at premium cost.
interface KeyFactory {
  submission(): SubmissionKey; // S secure unique ID, no network.
  command(): CommandKey; // S a different identity space.
  acquisition(): AcquisitionKey; // S recover an opener after an unknown reply.
}

// 3. Core admission. A message is not a run.

interface SubmitOptions {
  readonly key?: SubmissionKey; // omission mints once per invocation.
  readonly history?: HistoryEpoch; // shown history; omission follows rule below.
  readonly configuration?: InputChoice; // omission captures branch selection at admission.
  readonly source?: string; // optional attribution, never execution permission.
}
interface AdmissionRecord {
  readonly key: SubmissionKey;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly change: InputChangeId;
  readonly history: HistoryEpoch;
  readonly execution: "covered" | "uncovered"; // Admission-time observation, not a liveness guarantee.
  readonly choice: ResolvedChoice;
  readonly intent: "steer" | "queue";
  readonly placement:
    | { readonly kind: "response-boundary"; readonly runId: RunId }
    | {
        readonly kind: "next-turn";
        readonly reason: "requested" | "idle" | "run-ended" | "configuration";
      };
}
type InputLanding =
  | { readonly kind: "landed"; readonly commit: CommitId; readonly runId: RunId }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "superseded"; readonly by: SubmissionKey };
// AdmissionRecord is the admission-time receipt; landing observes final placement.
interface InputHandle {
  readonly key: SubmissionKey;
  receipt(): Promise<Result<Lookup<AdmissionRecord>, RequestFailure>>;
  landing(options?: RequestOptions): Promise<Result<InputLanding, RequestFailure>>; // O wait only.
  withdraw(options?: RequestOptions): Promise<Result<Withdrawal, MutationFailure>>; // O the single withdrawal operation.
}
interface AdmittedInput extends InputHandle {
  readonly record: AdmissionRecord;
}
// Head.input(key) reacquires the same InputHandle even before receipt. The client
// journal submits intent; only core confirms withdrawal. A host landed receipt
// overrides local assumptions. Offline withdrawal retains an uncertain tombstone
// intent, not a fabricated host rejection.
type Withdrawal =
  | { readonly kind: "withdrawn" }
  | { readonly kind: "landed"; readonly commit: CommitId; readonly runId: RunId }
  | { readonly kind: "uncertain"; readonly key: SubmissionKey };
// Reconcile network failures by original key; they cannot confirm withdrawal.
// Withdrawing an unseen key durably prevents its later admission. Tombstones
// are scoped by host + principal + session + head, cannot cancel another
// principal's work, and cannot expire while that key remains replayable.

interface ConfigurationReceipt {
  readonly key: CommandKey;
  readonly revision: BranchRevision;
  readonly selected: ResolvedChoice;
}

interface PendingInputs {
  list(): Promise<Result<readonly PendingInput[], RequestFailure>>;
  revise(input: {
    readonly key: SubmissionKey;
    readonly expect: BranchRevision;
    readonly content?: UserContent; // omit = keep content, not clear.
    readonly delivery?: "steer" | "queue"; // omit = keep intention.
    readonly position?: QueuePosition; // omit = keep order; no nullable position.
  }): Promise<Result<PendingRevision, MutationFailure>>;
}
type PendingInput = { readonly record: AdmissionRecord; readonly state: "pending" };
type PendingRevision =
  | { readonly kind: "revised"; readonly input: AdmissionRecord }
  | { readonly kind: "unchanged" }
  | { readonly kind: "landed"; readonly runId: RunId }
  | { readonly kind: "stale"; readonly current: BranchRevision }
  | { readonly kind: "missing" };

/**
 * Admission transaction:
 * 1. Parse and authorize once at the boundary; normalize/upload before CAS.
 * 2. Look up the key within this principal/session/head. The same normalized
 *    request digest returns the original receipt; a different digest returns
 *    KeyConflict. Hash requested content/delivery/epoch/choice patch. Retries use
 *    the original resolved defaults. The resolved policy snapshot has a separate
 *    immutable compatibility digest.
 * 3. Resolve selected configuration and create the immutable input/config record.
 * 4. Assert history epoch and publish input + receipt + runnable obligation in
 *    one store transaction, under the same four authorities, not another workflow DB.
 * 5. Wake is a hint; the scheduler repairs durable runnable heads after crashes.
 *
 * Navigation/edit advances history generation; model commits and append-only
 * compaction do not. It is not the moving tip. The journal freezes the epoch
 * before acknowledging local storage, so delayed inputs cannot cross a rewind
 * even if they were absent from the host inbox.
 *
 * UI callers pass the displayed epoch. When omitted, SDK captures its latest
 * observed epoch at invocation or reads it before storage/admission. Offline
 * without an epoch is not-stored. Retries keep that epoch. Stale input stays
 * locally held and returns history-changed; rebase requires user intent and a
 * new key. A newly created session handle knows its initial epoch.
 *
 * .steer joins a compatible live run at the next safe response boundary, never
 * during provider streaming or external tool execution. If the run ends first,
 * the same input becomes next-turn input without client resend. Incompatible
 * configuration becomes next-turn input with reason configuration.
 *
 * .queue starts at an idle boundary after eligible steers. Drain-all combines
 * only a leading compatible configuration group; later model choices cannot
 * override earlier inputs through passive configs. Resolved choice survives
 * restart. Prepare and record prompt/tool declarations before each provider
 * request, not during admission. Recovery never silently substitutes an
 * unavailable model or previously offered tool catalog.
 *
 * configure changes durable defaults. Per-input configuration affects only
 * that input, not shared session defaults; no configure-then-send is needed.
 */

// 4. Session and head handles. Binding is synchronous; mutations are not fluent.

interface Sdk {
  readonly hostId: HostId;
  readonly principal: PrincipalId;
  readonly keys: KeyFactory;
  readonly sessions: SessionsDirectory;
  readonly workspaces: WorkspaceDirectory;
  readonly models: ModelDirectory;
  readonly deliveries: DeliveryJournal;
  readonly administration: AdministrationCapabilities;
  readonly operations: OperationsDirectory;
  catalog(options?: RequestOptions): Promise<Result<CatalogView, RequestFailure>>; // O self-description of this host.
  events(options?: RequestOptions): AsyncIterable<Result<HostEventFrame, RequestFailure>>; // W host-wide facts, not session history.
  session(id: SessionId): SessionHandle; // S main head + session management.
  workspace(id: WorkspaceId): WorkspaceHandle; // S stable workspace, not UI selection.
}
interface CatalogView {
  readonly generation: CatalogGeneration;
  readonly operations: readonly OperationInfoView[];
  readonly commands: readonly CommandInfoView[];
  readonly tools: readonly ToolInfoView[];
}
interface OperationInfoView {
  readonly name: string;
  readonly description: string;
  readonly authority: OperationDeclaration<unknown, unknown, unknown>["authority"];
  readonly execution: OperationDeclaration<unknown, unknown, unknown>["execution"];
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  readonly failure: JsonSchema;
  readonly example?: { readonly request: Json; readonly response: Json };
  readonly notes?: readonly string[]; // rules the schema cannot express.
}
interface ToolInfoView {
  readonly name: string;
  readonly owner: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}
type CatalogGeneration = Id<"catalog-generation">;
type JsonSchema = { readonly [name: string]: Json };
type HostEventFrame =
  | { readonly kind: "catalog-changed"; readonly generation: CatalogGeneration }
  | {
      readonly kind: "plugins-changed";
      readonly generation: CatalogGeneration;
      readonly plugins: readonly PluginInfoView[];
    }
  | { readonly kind: "settings-changed"; readonly keys: readonly string[] };
// The catalog is the same OperationDeclaration data that generates the TS
// client, served at runtime so a host on another version, a non-TS client or
// an agent can bind without our docs. Plugin commands and tools appear under
// their owner. A name absent from the catalog answers unavailable, never a
// transport failure. catalog-changed replaces client-side plugin invalidation;
// a client refetches lists it caches and compares generation. Unknown frame
// kinds are skipped per the section 9 rule.
interface SessionsDirectory {
  create(input?: {
    readonly id?: SessionId; // omit -> generated before first attempt.
    readonly name?: string; // omit -> unnamed; null invalid.
    readonly workspace?: WorkspaceId; // omit -> host's declared default, never UI global.
    readonly configuration?: InputChoice;
  }): Promise<Result<SessionHandle, ConfigurationFailure>>; // A durable creation; handle itself is not Owned.
  find(id: SessionId): Promise<Result<Lookup<SessionInfoView>, RequestFailure>>;
  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Result<Page<SessionInfoView>, RequestFailure>>;
}
// Stable id+request digest makes creation idempotent; a different payload
// conflicts. A parent's history pointer does not grant delegation ownership.

interface HeadHandle {
  readonly sessionId: SessionId;
  readonly name: HeadName;
  view(options?: RequestOptions): Promise<Result<SessionView, RequestFailure>>; // O missing addressed resource is error.
  observe(options?: RequestOptions): Promise<Result<SessionObservation, ResourceOpenFailure>>; // A local owned subscription.
  events(
    input: { readonly from: "start" | "live" | Seq },
    options?: RequestOptions,
  ): AsyncIterable<Result<SessionEventFrame, RequestFailure>>; // W advanced raw feed.
  steer(
    content: UserContent,
    options?: SubmitOptions,
  ): Promise<Result<AdmittedInput, AdmissionFailure>>; // O.
  queue(
    content: UserContent,
    options?: SubmitOptions,
  ): Promise<Result<AdmittedInput, AdmissionFailure>>; // O.
  configure(
    patch: ChoicePatch,
    options?: { readonly key?: CommandKey },
  ): Promise<Result<ConfigurationReceipt, ConfigurationFailure>>; // O.
  readonly pending: PendingInputs;
  input(key: SubmissionKey): InputHandle; // S one withdrawal/reconciliation address.
  run(id: RunId): RunHandle; // S exact identity, not whatever is currently live.
  tree(options?: RequestOptions): Promise<Result<HistoryReader, HistoryFailure>>; // A retained graph pin.
  branch(input: {
    readonly name: string;
    readonly from: Position;
    readonly key: CommandKey;
  }): Promise<Result<BranchOutcome, MutationFailure>>; // O.
  navigate(input: NavigateInput): Promise<Result<Operation<NavigationOutcome>, CommandFailure>>; // O admitted long operation.
  edit(input: EditInput): Promise<Result<Operation<EditOutcome>, CommandFailure>>; // O replaces app sequencing.
  compact(input: {
    readonly key: CommandKey;
    readonly instructions?: string;
  }): Promise<Result<Operation<CompactResult>, CommandFailure>>; // O keyed paid operation.
  context(): Promise<Result<ContextView, RequestFailure>>; // O selected provider input/token accounting.
  markSeen(
    position: Position,
    options?: RequestOptions,
  ): Promise<Result<SeenOutcome, MutationFailure>>; // O forward-only; no wake, no revision change.
}
interface SideHeadHandle extends HeadHandle {
  readonly name: SideHeadName;
  merge(input: { readonly expect: BranchRevision }): Promise<Result<MergeResult, MutationFailure>>; // O stack-parent fast-forward.
  remove(input: {
    readonly expect: BranchRevision;
  }): Promise<Result<RemoveHeadResult, MutationFailure>>; // O.
}
interface SessionHandle extends HeadHandle {
  readonly id: SessionId;
  head(name: SideHeadName): SideHeadHandle; // S main is already bound; side name parsed once.
  info(): Promise<Result<SessionInfoView, RequestFailure>>;
  update(patch: {
    readonly name?: string | null;
    readonly pinned?: boolean;
    readonly archived?: boolean;
  }): Promise<Result<void, MutationFailure>>;
  // name:null clears title; omitted fields unchanged. Null booleans rejected.
  removeSession(input: {
    readonly expect: BranchRevision;
  }): Promise<Result<RemoveSessionResult, MutationFailure>>;
  heads(): Promise<Result<readonly HeadInfoView[], RequestFailure>>;
  children(): Promise<Result<readonly SessionInfoView[], RequestFailure>>; // Delegated sessions, not conversation heads.
  readonly jobs: JobsApi;
  readonly plugins: PluginReadApi;
}
type BranchOutcome =
  | { readonly kind: "created"; readonly head: SideHeadHandle; readonly basedOn: Position }
  | { readonly kind: "exists"; readonly name: HeadName }
  | { readonly kind: "missing-source" };
// branch creates a named head in this session, retains history and copies
// historical config/tool declarations at from. Its inbox is empty; it creates
// no inference, run, effects or jobs. Workspace stays shared. It is not a Git
// branch, copied session, delegated child or isolated filesystem. Parallel
// writers should provision a separate workspace. v1 has no cross-session fork;
// a future clone needs explicit copy policies, not an alias for branch or delegation.create.

interface RunHandle {
  readonly id: RunId;
  info(): Promise<Result<RunRecord, RequestFailure>>; // Addressed missing run is SdkFailure.missing.
  stop(): Promise<Result<StopResult, MutationFailure>>; // O durable Stop accepted; not process cleanup completion.
  settled(options?: RequestOptions): Promise<Result<RunEnd, RequestFailure>>; // O exact run, never a later run.
  reply(input: {
    readonly call: CallId;
    readonly wait: WaitId;
    readonly value: Json;
  }): Promise<Result<ReplyResult, MutationFailure>>; // O.
  changes(): Promise<Result<RunChanges, RequestFailure>>; // O exact snapshots or explicitly incomplete records.
  restore(input: {
    readonly key: CommandKey;
    readonly evidence: ExactRunChanges;
  }): Promise<Result<Operation<RestoreResult>, CommandFailure>>;
}
type StopResult =
  | { readonly kind: "requested" }
  | { readonly kind: "ended"; readonly end: RunEnd }
  | { readonly kind: "missing" };
type ReplyResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "stale-wait" }
  | { readonly kind: "missing" };
type RunEnd =
  | { readonly kind: "completed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly diagnostic: string };
type RunRecord =
  | { readonly kind: "live"; readonly run: RunView }
  | { readonly kind: "ended"; readonly id: RunId; readonly end: RunEnd };
interface RunView {
  readonly id: RunId;
  readonly phase: "responding" | "executing" | "waiting" | "retrying";
  readonly configuration: ResolvedChoice;
}
type ExecutionView =
  | { readonly kind: "idle"; readonly last: RunId | null }
  | { readonly kind: "live"; readonly run: RunView };
// last:null = no previous run, not an optional isRunning/runId pair.
// Stop revokes this run's continuation grants. Delegation ownership, not branch
// ancestry, authorizes cancellation of child sessions.

// 5. /tree, edit, compaction. Shared by all consumers, including remote clients.

interface HistoryReader extends Owned {
  readonly revision: BranchRevision;
  readonly atSeq: Seq;
  readonly expiresAt: number; // Current host lease deadline in epoch milliseconds.
  readonly renewableUntil: number; // Hard lifetime limit, fixed at acquisition.
  readonly heads: readonly HeadInfoView[];
  renew(): Promise<
    Result<
      { readonly kind: "renewed"; readonly until: number } | { readonly kind: "expired" },
      HistoryFailure
    >
  >;
  pages(): AsyncIterable<Result<readonly HistoryNode[], HistoryFailure>>; // W bounded parent-before-child pages.
}
interface HistoryNode {
  readonly id: CommitId;
  readonly parent: CommitId | null; // null = root, never missing page/loading.
  readonly kind:
    | "user"
    | "assistant"
    | "tool"
    | "system"
    | "config"
    | "checkpoint"
    | "summary"
    | "completion"
    | "usage";
  readonly imports: readonly CommitId[];
  readonly preview: string;
}
type NavigationRunning =
  | { readonly kind: "refuse" }
  | { readonly kind: "stop"; readonly runId: RunId };
interface NavigateInput {
  readonly key: CommandKey;
  readonly selection: Position;
  readonly expect: BranchRevision;
  readonly running: NavigationRunning;
  readonly abandoned:
    | { readonly kind: "keep" }
    | { readonly kind: "summarize"; readonly instructions?: string };
}
interface EditInput {
  readonly key: CommandKey;
  readonly message: CommitId; // Must resolve to a user message, checked at boundary.
  readonly expect: BranchRevision;
  readonly running: NavigationRunning;
  readonly replacement: { readonly content: UserContent; readonly configuration?: InputChoice };
}
interface Operation<Outcome> {
  readonly key: CommandKey;
  status(): Promise<
    Result<
      { readonly kind: "pending" } | { readonly kind: "settled"; readonly outcome: Outcome },
      RequestFailure
    >
  >;
  settled(options?: RequestOptions): Promise<Result<Outcome, RequestFailure>>; // O wait; abort doesn't cancel command.
  stop(): Promise<
    Result<
      { readonly kind: "requested" } | { readonly kind: "settled"; readonly outcome: Outcome },
      MutationFailure
    >
  >; // O explicit command stop.
}
type NavigationOutcome =
  | {
      readonly kind: "navigated";
      readonly revision: BranchRevision;
      readonly position: Position;
      readonly handback:
        | { readonly kind: "none" }
        | { readonly kind: "message"; readonly content: UserContent };
      readonly summary: CommitId | null; // null = no summary published.
    }
  | { readonly kind: "stale"; readonly current: BranchRevision; readonly stoppedRun: RunId | null }
  | { readonly kind: "busy"; readonly runId: RunId }
  | { readonly kind: "pending-input"; readonly keys: readonly SubmissionKey[] }
  | { readonly kind: "missing-target" }
  | { readonly kind: "stopped"; readonly stoppedRun: RunId | null }
  | {
      readonly kind: "summary-failed";
      readonly diagnostic: string;
      readonly stoppedRun: RunId | null;
    };
type EditOutcome =
  | {
      readonly kind: "edited";
      readonly revision: BranchRevision;
      readonly admission: AdmissionRecord;
    }
  | Exclude<NavigationOutcome, { readonly kind: "navigated" }>;

/**
 * Tree contract:
 * - A coherent manifest of retained OIDs, head tips and seq is protected from GC
 *   by a read pin with bounded, renewable expiry. The host supplies positive,
 *   finite leaseMs/maxLifetimeMs/maxReaders limits before opening storage.
 *   Renew extends expiresAt by at most leaseMs, never beyond renewableUntil.
 *   Failed or expired renewal does not acquire a different graph. Reopen explicitly.
 *   Expiry gives snapshot-expired, never pages from a later graph. Close releases
 *   the pin; an abandoned reader expires without requiring its client to return.
 * - All retained branches, including abandoned history, are available. UI may
 *   hide usage nodes, but they stay addressable. Transcript is not the graph.
 * - BranchRevision is an opaque token covering relevant head/run/config/inbox
 *   expectations, not wall time or only the displayed tip. Seen marks are
 *   outside it; reading cannot make navigate/edit stale.
 * - Selecting a user commit moves to its parent and offers its content. Other
 *   nodes land on themselves. Keep and summarize preserve history.
 * - Summary uses source configuration, has the landing point as parent and
 *   imports abandoned commits. Failed CAS does not erase recorded provider spend.
 *
 * navigate/edit store command state in objects/refs using existing fenced steps,
 * not UI-held RPC requests, another workflow database or persisted JS continuations.
 *
 * Before Stop, validate revision, pending inbox and target, then pin the target.
 * Pre-checkable refusals cannot stop a run. After Stop, changed inbox/head conditions
 * return stale, not pending-input/missing-target. Callers explicitly choose the
 * default refuse behavior or stop the exact observed run. Stop settlement is
 * irreversible and precedes navigation; stoppedRun reports it if navigation fails.
 * Revalidation accepts only changes caused by that stop. Unrelated head/config/inbox
 * changes return stale, not an automatic reread/retry.
 *
 * Pending user inputs block move/edit. Callers must withdraw or place them before
 * retrying; inputs are never silently discarded or retargeted.
 *
 * After preparation, one CAS publishes move + optional summary and, for edit,
 * replacement input + captured choice + receipt + wake obligation. Failure before
 * CAS leaves history unchanged. Plain navigate never starts model work. Command
 * stop can prevent publication; after publication it returns the settled result.
 * Transport interruption stops only waiting.
 *
 * The edit CAS increments history epoch and admits replacement against it. Old
 * locally retained inputs fail their epoch assertion. Admitted commands retain
 * their own targets, so closing a picker cannot expose them to GC.
 * File restore is outside this transaction.
 */

// 6. Observation and the request gap. One SDK implementation, no UI controller.

interface SessionView {
  readonly revision: BranchRevision;
  readonly history: HistoryEpoch;
  readonly activation: WorkspaceActivation;
  readonly seq: Seq;
  readonly position: Position;
  readonly seen: SeenMark;
  readonly unseen: CommitId | null; // oldest drawn commit after the mark; null = nothing unseen.
  readonly transcript: readonly TurnView[];
  readonly pending: readonly PendingInput[];
  readonly parked: readonly ParkedWait[];
  readonly execution: ExecutionView;
  readonly configuration: {
    readonly selected: ResolvedChoice | null;
    readonly effective: ResolvedChoice | null;
  };
  readonly transient: {
    readonly completeness: "complete" | "gap";
    readonly parts: readonly LivePartView[];
  };
}
type WorkspaceActivation =
  | { readonly kind: "active" }
  | { readonly kind: "inactive" }
  | { readonly kind: "trust-required" }
  | { readonly kind: "unavailable"; readonly reason: string };
// selected:null = no model configuration; effective:null = no effective request yet.
// Reading history must not load project code or demand active model credentials.
interface ParkedWait {
  readonly run: RunId;
  readonly call: CallId;
  readonly generation: WaitId;
  readonly reason:
    | { readonly kind: "question"; readonly selection: Selection; readonly deadline: number | null }
    | {
        readonly kind: "dependency";
        readonly ids: readonly CommandKey[];
        readonly deadline: number | null;
      }
    | { readonly kind: "timer"; readonly deadline: number };
}
// deadline:null = no timer; never "not loaded".

type SeenMark =
  | { readonly kind: "never" } // no reader has marked this head.
  | { readonly kind: "at"; readonly position: Position }; // start = opened empty; commit = on the tip's chain.
type SeenOutcome =
  | { readonly kind: "advanced"; readonly seen: Position } // mark moved forward; one fact event.
  | { readonly kind: "unchanged"; readonly seen: Position } // at or behind the mark; no write, no event.
  | { readonly kind: "missing-target" }; // names no commit of this session.
interface HeadInfoView {
  readonly name: HeadName;
  readonly tip: Position; // start = no commits yet.
  readonly stack: {
    readonly parent: HeadName;
    readonly base: Position;
    readonly stale: boolean;
  } | null; // null = not stacked.
  readonly execution: ExecutionView;
  readonly seen: SeenMark;
  readonly unseen: CommitId | null; // same derivation as SessionView.unseen; sidebar dot = unseen !== null.
}
// Based on protocol/src/sdk.ts:97-106 HeadInfo {head, tip, stack?, run?}; lifecycle states are explicit.
type TurnView =
  | {
      readonly kind: "turn";
      readonly id: CommitId; // first commit of the turn; views.ts:61 Turn.id.
      readonly run: RunId | null; // null = seeded/foreign turn, not unknown.
      readonly parts: readonly TurnPartView[];
      readonly failure: Failure | null; // null = ended without error/abort.
      readonly startedAt: number;
      readonly durationMs: number; // record's span; only grows, transcript.ts:284.
    }
  | {
      readonly kind: "checkpoint";
      readonly commit: CommitId;
      readonly at: number;
      readonly body: CheckpointBody;
    }
  | {
      readonly kind: "summary";
      readonly commit: CommitId;
      readonly at: number;
      readonly body: SummaryBody;
    }
  | {
      readonly kind: "config";
      readonly commit: CommitId;
      readonly at: number;
      readonly body: ConfigBody;
    };
type TurnPartView =
  | {
      readonly kind: "user";
      readonly commit: CommitId;
      readonly content: UserContent;
      readonly at: number;
      readonly key: SubmissionKey | null;
      readonly source: MessageSource | null;
    }
  | {
      readonly kind: "assistant";
      readonly commit: CommitId;
      readonly contentIndex: number;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly kind: "thinking";
      readonly commit: CommitId;
      readonly contentIndex: number;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly kind: "tool";
      readonly commit: CommitId;
      readonly call: CallId;
      readonly result: CommitId | null;
      readonly class: TurnToolClass;
      readonly state: ToolState;
      readonly output: string | null;
      readonly at: number;
    };
// Shapes follow protocol/src/views.ts:16-54 and transcript.ts:165-180 part identity.
// user/assistant/thinking name their containing commit; tool names the issuing
// assistant commit. transcript.ts:255 currently drops item.oid. result:null = no
// landed result; key:null = none supplied; source:null = unattributed. Core edit
// resolves the parent instead of UserTurnPart.parent. Part identity is
// (commit, contentIndex) or (commit, call); views own render keys.
type LivePartView =
  | {
      readonly kind: "text" | "thinking";
      readonly run: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "tool";
      readonly run: RunId;
      readonly call: CallId;
      readonly progress: ToolProgress;
    };
// client live-parts.ts:3-23. Non-durable parts have no CommitId and cannot be seen
// marks, anchors or under the divider. Landing converts them to TurnPartView.
type ScrollAnchor =
  | { readonly kind: "bottom" }
  | { readonly kind: "commit"; readonly commit: CommitId; readonly offsetPx: number };
// Per-window view memory keyed by session+head, not a fact or wire value.
// At mount, freeze unseen as the divider. Restore the anchor or scroll to the
// divider, bottom when null. Mark only TurnPartView commits shown while the
// document was visible and focused.

/**
 * Seen marks:
 * - Each head has a SeenMark session fact `seen:<head>` in refs/facts/, escaped
 *   per names.ts:150. Its blob names a commit as JSON. gc.ts:49 roots are ref
 *   oids and retained ref events, so seen marks do not pin history.
 * - markSeen(P) maps start to start, an unloadable/non-session commit to
 *   missing-target, and a commit on the tip's chain to P. Otherwise use the
 *   fork point, the newest commit shared by P's and the tip's chains, or start.
 *   Replace a never mark or advance to a strict descendant of the effective
 *   mark; otherwise return unchanged without write/event. On CAS conflict,
 *   re-evaluate against the winner, not writeBlobRef's rewrite retry in
 *   session-pool.ts:374-410.
 * - Reads report the effective mark. Use the stored position on the tip's chain,
 *   its fork point with the tip after navigate/edit/merge, or start if GC made
 *   the stored commit unloadable. navigate/edit leave the mark untouched; the
 *   next markSeen stores an ancestor of the new tip.
 * - unseen is the oldest drawn commit after the effective mark on the tip's
 *   chain. Count user, assistant, tool result, checkpoint, summary and config,
 *   never usage/completion. Listing rows carry unseen per head.
 * - v1 has one authenticated owner per host. That owner's devices share the
 *   seen:<head> mark. Connect binds the owner's PrincipalId. Distinct reader
 *   principals are not supported by v1; they cannot share this fact implicitly.
 * - Seen is outside BranchRevision and HistoryEpoch. Marking never makes a navigate,
 *   edit or input stale, and never starts, wakes or advances execution.
 *
 * Required fact write behavior, verified at c7094f5c:
 * - store.ts:10-14,76-79: refs.update appends one `ref` event per changed ref and
 *   wakes every events.watch in the same transaction. to === from writes no row
 *   or event; session-pool.ts:390 skips equal oids. events.ts:318-332 projects
 *   SessionEvent {kind:"fact", key, value} to every observer.
 * - runner.ts:599-633 handleRef does not match refs/facts/* to head/inbox/run/effect
 *   prefixes. cache-warming.ts:296-309 reads only head/run refs; advance.ts:45 only
 *   runRef. Facts cause no runner wake, advance or admission. Their single-ref
 *   CAS is disjoint from head/inbox/run refs and cannot fail admission CAS.
 * - reads.ts:71-84 rowHolds invalidates a listing row on any later ref event.
 *   The next list re-reads main, session-pool.ts:575-580, to update unseen.
 *   The write-rate bound below limits these reads.
 * - client session-follow.ts:71-78 re-reads metadata on every fact event;
 *   session-state.ts:383 folds only `name` locally. Without mitigation, each
 *   scroll tick causes a metadata read on every session observer.
 * Required mitigations:
 * - Views coalesce per head, trailing edge, one in flight, bounded rate, using
 *   only the newest shown commit. Forward-only no-op absorbs the rest.
 * - observe folds `seen` locally and recomputes unseen from its transcript,
 *   without a session re-read for fact events.
 * - Fact refs stay outside every runner/advance/warming filter. A future wake
 *   source must be a named ref family, never refs/facts/*.
 */
interface SessionObservation extends Owned {
  getSnapshot(): SessionObservationState; // S referentially stable until semantic change.
  subscribe(listener: () => void): () => void; // S listener disposer only.
  frames(): AsyncIterable<Result<SessionObservationState, RequestFailure>>; // W alternative view consumption.
}
type SessionObservationState =
  | {
      readonly kind: "ready";
      readonly connection:
        | { readonly kind: "live" }
        | { readonly kind: "recovering"; readonly failure: RequestFailure };
      readonly value: SessionView;
      readonly outgoing: readonly LocalDelivery[];
    }
  | { readonly kind: "missing" }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: RequestFailure };
// observe resolves after the initial authoritative read; its pending Promise
// is loading. Denied/missing transitions cannot report stale content as live.

type LocalDelivery = { readonly key: SubmissionKey; readonly content: UserContent } & (
  | { readonly kind: "storing" }
  | { readonly kind: "stored" }
  | { readonly kind: "sending" }
  | { readonly kind: "retrying"; readonly failure: RequestFailure }
  | { readonly kind: "admitted"; readonly record: AdmissionRecord }
  | { readonly kind: "withdrawal-uncertain" }
  | {
      readonly kind: "held";
      readonly failure: Extract<SdkFailure, { readonly kind: "history-changed" }>;
    }
  | { readonly kind: "failed"; readonly failure: AdmissionFailure | JournalFailure }
);
interface DeliveryJournal {
  entry(key: SubmissionKey): DeliveryEntry; // S local identity, no new submission.
}
interface DeliveryEntry {
  stored(): Promise<Result<{ readonly durability: "memory" | "persistent" }, JournalFailure>>; // O local acknowledgement only.
  state(): LocalDelivery | null; // S null means no local entry, not host rejection.
}
async function proposedOptimisticComposer(
  sdk: Sdk,
  id: SessionId,
  history: HistoryEpoch,
  draft: UserContent,
  choice: ChoicePatch,
  clearSubmittedDraft: () => void,
) {
  const key = sdk.keys.submission();
  const admission = sdk.session(id).queue(draft, { key, history, configuration: choice });
  const local = sdk.deliveries
    .entry(key)
    .stored()
    .then((stored) => {
      if (stored.ok && stored.value.durability === "persistent") clearSubmittedDraft();
      return stored;
    });
  // Both promises are observed immediately, including unexpected rejection.
  // The callback clears only the captured draft, never newer user input.
  const [stored, receipt] = await Promise.all([local, admission]);
  if (!stored.ok) return stored;
  if (stored.value.durability === "memory" && receipt.ok) clearSubmittedDraft();
  return receipt;
}

/**
 * queue/steer synchronously register the journal key before their first await,
 * so entry(key).stored() joins the same attempt. Normalization/storage failure
 * returns typed failures from both promises. Connections, not views, own
 * records and retry tasks. A locally retained request can later receive an
 * admission failure; keep that distinction visible rather than clearing intent.
 * Keyed commands, session creation and resource acquisition journal immutable
 * identity/body before transmission, with their own acknowledgement promises.
 * OperationsDirectory reconciles command receipts. Unknown write failures carry
 * identity even when the caller omitted key/id.
 *
 * Partitions bind HostId/principal/workspace/session/head at submit. Workspace
 * selection cannot clear another partition's flights. Retry only writes whose
 * contracts supply identity, never arbitrary writes or single-use streams via a
 * generic HTTP wrapper. Client close stops retries but keeps persistent records.
 * App connections select persistent IndexedDB storage. TUI/embedded connections
 * select memory unless configured otherwise. This is an explicit JournalProfile,
 * not runtime environment detection. Memory profiles make no crash guarantee.
 * UI teardown stops observation, not queued delivery or remote work.
 *
 * Core defines snapshots/read models. Transport recovers cursors and applies
 * authoritative frames with the same pure core/view fold. Durable replay stays
 * ordered while its cursor is retained. Expiry/overflow sends reset + snapshot,
 * promising convergence, not every intermediate UI state. Mark lost transient
 * deltas as a gap and replace them with settlement. Pull/backpressure bounds
 * bytes. HTTP streaming uses bounded buffers and disconnect/rebase; WebSocket
 * RPC is not required. Session deltas, blobs, browser state and PTY output each
 * have their own policy.
 */

// 7. Files, changes, browser and terminal. Behavior in core, I/O in drivers.

interface WorkspaceHandle {
  readonly id: WorkspaceId;
  info(): Promise<Result<WorkspaceInfoView, RequestFailure>>;
  files(): Promise<Result<Capability<FilesApi>, RequestFailure>>;
  changes(): Promise<Result<Capability<ChangesApi>, RequestFailure>>;
  git(): Promise<Result<Capability<GitApi>, RequestFailure>>;
  browser(): Promise<Result<Capability<BrowserApi>, RequestFailure>>;
  terminals(): Promise<Result<Capability<TerminalsApi>, RequestFailure>>;
}
// Capability requests are O and may use negotiated cached descriptors. They
// do not start browsers/PTYs, trust folders or mount native views. Explicit
// outcomes distinguish unavailable capabilities from uninitialized ones.

interface FilesApi {
  scan(input?: {
    readonly directory?: string;
    readonly ignored?: "exclude" | "include";
  }): Promise<Result<FileTreeScan, ResourceOpenFailure>>; // A.
  read(path: string): Promise<Result<FileDocument, RequestFailure>>; // O small text or explicit binary/large.
  bytes(input: {
    readonly path: string;
    readonly expect: FileVersion;
  }): Promise<Result<ByteReader, ResourceOpenFailure>>; // A owned FD/response.
  save(input: {
    readonly path: string;
    readonly contents: string;
    readonly expect: FileVersion;
  }): Promise<Result<FileWriteResult, MutationFailure>>;
  format(input: {
    readonly path: string;
    readonly contents: string;
    readonly expect: FileVersion;
  }): Promise<Result<FormatResult, MutationFailure>>;
  search(input: {
    readonly query: string;
    readonly limit?: number;
  }): AsyncIterable<Result<SearchFrame, RequestFailure>>; // W ends with completeness.
  blame(path: string): Promise<Result<BlameResult, RequestFailure>>;
  watch(): AsyncIterable<Result<FileChangeFrame, RequestFailure>>; // W invalidation hints, not a transaction log.
  upload(
    source: AsyncIterable<Uint8Array>,
    options?: RequestOptions,
  ): Promise<Result<BlobId, MutationFailure>>; // O bounded streaming.
}
interface FileTreeScan extends Owned {
  pages(): AsyncIterable<
    Result<
      | { readonly kind: "entries"; readonly entries: readonly FileEntryView[] }
      | { readonly kind: "complete" }
      | { readonly kind: "incomplete"; readonly reason: "limit" | "changed" | "permission" },
      RequestFailure
    >
  >;
}
// Omitted directory = workspace root, not host root; omitted ignored = exclude.
// A truncated scan cannot report complete. Enumeration is not atomic under external
// edits. Run changes use a separate pinned immutable tree, FileSnapshotId.
interface ByteReader extends Owned {
  readonly version: FileVersion;
  readonly size: number;
  chunks(): AsyncIterable<Result<Uint8Array, RequestFailure>>; // W one consumer; close/return releases reader.
}
type FileDocument =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly contents: string;
      readonly version: FileVersion;
    }
  | {
      readonly kind: "binary";
      readonly path: string;
      readonly size: number;
      readonly version: FileVersion;
    }
  | {
      readonly kind: "large";
      readonly path: string;
      readonly size: number;
      readonly version: FileVersion;
    }
  | { readonly kind: "missing"; readonly path: string };
type FileWriteResult =
  | { readonly kind: "saved"; readonly version: FileVersion }
  | { readonly kind: "conflict"; readonly current: FileVersion }
  | { readonly kind: "missing" }
  | { readonly kind: "partial"; readonly diagnostic: string };
// In-process locks cannot prevent external writes. Drivers must document
// single-path atomicity; there is no universal filesystem CAS guarantee.

interface ChangesApi {
  read(input: { readonly base: ChangeBase }): Promise<Result<ChangeRead, RequestFailure>>;
  batch(input: { readonly key: CommandKey }): FileBatch; // S immutable plan.
}
type ChangeBase =
  | { readonly kind: "working" }
  | { readonly kind: "staged" }
  | { readonly kind: "git-commit"; readonly commit: GitCommitId }
  | { readonly kind: "file-snapshots"; readonly from: FileSnapshotId; readonly to: FileSnapshotId };
type ChangeRead =
  | {
      readonly kind: "exact";
      readonly revision: FileSnapshotId;
      readonly files: readonly FileDelta[];
    }
  | { readonly kind: "unavailable"; readonly reason: string };
type ExpectedFile =
  | { readonly kind: "absent" }
  | { readonly kind: "version"; readonly version: FileVersion };
interface FileBatch {
  put(input: {
    readonly path: string;
    readonly blob: BlobId;
    readonly expect: ExpectedFile;
  }): FileBatch; // S new immutable plan.
  remove(input: { readonly path: string; readonly expect: FileVersion }): FileBatch; // S guarded delete.
  apply(): Promise<Result<Operation<FileBatchResult>, MutationFailure>>; // O durable command receipt.
}
type FileBatchResult =
  | {
      readonly kind: "applied";
      readonly snapshot: FileSnapshotId;
      readonly paths: readonly string[];
    }
  | { readonly kind: "conflict"; readonly paths: readonly string[] }
  | {
      readonly kind: "partial";
      readonly applied: readonly string[];
      readonly remaining: readonly string[];
      readonly diagnostic: string;
    }
  | { readonly kind: "stopped"; readonly applied: readonly string[] };
// Each path carries its checked expectation, including absence. Working-tree
// reports sample bytes, not a cross-path instant. A batch is one reviewed intent,
// not cross-file ACID. Record progress before advancing. Recovery compares
// expected/before/desired bytes and refuses external drift, rather than repeating
// writes/deletes blindly. Blobs are replayable; consumed upload streams are not.

interface ExactRunChanges {
  readonly kind: "exact";
  readonly run: RunId;
  readonly environment: EnvironmentId;
  readonly from: FileSnapshotId;
  readonly to: FileSnapshotId;
  readonly files: readonly FileDelta[];
}
type RunChanges =
  | ExactRunChanges
  | { readonly kind: "recorded"; readonly files: readonly FileDelta[] }
  | { readonly kind: "missing" };
type RestoreResult =
  | FileBatchResult
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "no-snapshot" }
  | { readonly kind: "environment-changed" };
// Restore requires exact evidence. Its to snapshot supplies per-path expected
// versions, with no separate expect. Core verifies the run's recorded trees and
// reconstructs paths rather than trusting a caller's list. It checks environment
// and all workspace Nyte writers, then uses the same file operation owner.
// External editors remain external. Restore changes neither conversation nor Git HEAD.

interface GitApi {
  snapshot(): Promise<
    Result<
      | {
          readonly kind: "repository";
          readonly revision: GitRevision;
          readonly head: GitCommitId | null;
        }
      | { readonly kind: "none" },
      RequestFailure
    >
  >;
  // head:null = unborn Git repository, not absent Git capability.
  diff(input: GitDiffInput): Promise<Result<readonly FileDelta[], RequestFailure>>;
  contents(input: GitContentsInput): Promise<Result<GitFileSides, RequestFailure>>;
  log(input?: {
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Result<Page<GitCommitView>, RequestFailure>>;
  refs(): Promise<Result<GitRefsView, RequestFailure>>;
  at(revision: GitRevision): GuardedGit; // S expectation binding, not checkout.
}
interface GuardedGit {
  stage(paths: readonly [string, ...string[]]): Promise<Result<GitMutation, MutationFailure>>;
  unstage(paths: readonly [string, ...string[]]): Promise<Result<GitMutation, MutationFailure>>;
  discard(paths: readonly [string, ...string[]]): Promise<Result<GitMutation, MutationFailure>>;
  commit(input: {
    readonly message: string;
    readonly files: "staged" | "all" | readonly [string, ...string[]];
  }): Promise<Result<GitMutation, MutationFailure>>;
  branch(input: {
    readonly name: string;
    readonly checkout: boolean;
  }): Promise<Result<GitMutation, MutationFailure>>;
  push(input: { readonly setUpstream: boolean }): Promise<Result<GitMutation, MutationFailure>>;
}
// O mutations consume, not update, the reviewed expectation. After success,
// read again before writing. branch->commit->push is not an atomic fluent chain;
// report each successful step. "none" differs from unsupported Git or denied access.
type GitMutation =
  | { readonly kind: "applied"; readonly revision: GitRevision }
  | { readonly kind: "unchanged" }
  | { readonly kind: "stale"; readonly revision: GitRevision }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "rejected"; readonly reason: string };

async function proposedHighIoFiles(
  sdk: Sdk,
  workspaceId: WorkspaceId,
  bytes: AsyncIterable<Uint8Array>,
) {
  const workspace = sdk.workspace(workspaceId);
  const filesResult = await workspace.files();
  if (!filesResult.ok) return filesResult;
  const files = filesResult.value;
  const changesResult = await workspace.changes();
  if (!changesResult.ok) return changesResult;
  const changes = changesResult.value;
  if (files.kind !== "available") return filesResult;
  if (changes.kind !== "available") return changesResult;
  const scanResult = await files.value.scan();
  if (!scanResult.ok) return scanResult;
  await using scan = scanResult.value;
  for await (const pageResult of scan.pages()) {
    if (!pageResult.ok) return pageResult;
    const page = pageResult.value;
    renderFileTreePage(page);
  } // observes incomplete marker.
  const baselineResult = await changes.value.read({ base: { kind: "working" } });
  if (!baselineResult.ok) return baselineResult;
  const baseline = baselineResult.value;
  if (baseline.kind !== "exact") return baselineResult;
  const blobResult = await files.value.upload(bytes);
  if (!blobResult.ok) return blobResult;
  const blob = blobResult.value;
  const destinationResult = await files.value.read("generated/output.bin");
  if (!destinationResult.ok) return destinationResult;
  const destination = destinationResult.value;
  const obsoleteResult = await files.value.read("generated/obsolete.bin");
  if (!obsoleteResult.ok) return obsoleteResult;
  const obsolete = obsoleteResult.value;
  const expect: ExpectedFile =
    destination.kind === "missing"
      ? { kind: "absent" }
      : { kind: "version", version: destination.version };
  const put = changes.value
    .batch({ key: sdk.keys.command() })
    .put({ path: "generated/output.bin", blob, expect });
  const plan =
    obsolete.kind === "missing"
      ? put
      : put.remove({ path: "generated/obsolete.bin", expect: obsolete.version });
  // Builders are S; only apply() mutates, without whole-filesystem CAS.
  const operationResult = await plan.apply();
  if (!operationResult.ok) return operationResult;
  const operation = operationResult.value;
  return await operation.settled();
}

interface BrowserApi {
  open(input: {
    readonly url: string;
    readonly owner: PageOwner;
    readonly key: CommandKey;
  }): Promise<Result<PageHold, ResourceOpenFailure>>; // A new page, scoped hold.
  adopt(id: PageId): Promise<Result<PageHold, ResourceOpenFailure>>; // A same page, not URL matching.
  list(): Promise<Result<readonly BrowserPageView[], RequestFailure>>;
  destroy(id: PageId): Promise<Result<{ readonly kind: "destroyed" | "missing" }, MutationFailure>>;
}
type PageOwner =
  | { readonly kind: "session"; readonly session: SessionId }
  | { readonly kind: "workspace" };
interface PageHold extends Owned {
  readonly id: PageId;
  state(): Promise<Result<BrowserPageStateView, RequestFailure>>;
  states(): AsyncIterable<Result<BrowserPageStateView, RequestFailure>>;
  snapshot(): Promise<Result<PageSnapshot, RequestFailure>>;
  navigate(url: string): Promise<Result<PageActionResult, MutationFailure>>;
  back(): Promise<Result<PageActionResult, MutationFailure>>;
  forward(): Promise<Result<PageActionResult, MutationFailure>>;
  reload(): Promise<Result<PageActionResult, MutationFailure>>;
  stopLoading(): Promise<Result<PageActionResult, MutationFailure>>; // not stop a run/page owner.
  at(revision: DocumentRevision): GuardedPage; // S selected document generation.
  wait(
    input: PageWait,
    options?: RequestOptions,
  ): Promise<Result<PageActionResult, RequestFailure>>;
  console(input?: {
    readonly limit?: number;
    readonly clear?: boolean;
  }): Promise<Result<readonly ConsoleEntryView[], RequestFailure>>;
  capture(): Promise<Result<ByteReader, ResourceOpenFailure>>; // A owned encoded image stream, not base64 by default.
  readonly unsafe: {
    evaluate(
      expression: string,
    ): Promise<
      Result<
        | { readonly kind: "value"; readonly value: Json }
        | { readonly kind: "threw"; readonly message: string },
        RequestFailure
      >
    >;
  };
}
interface PageSnapshot {
  readonly revision: DocumentRevision;
  readonly nodes: readonly {
    readonly ref: string;
    readonly role: string;
    readonly name: string;
    readonly editable: boolean;
  }[];
}
interface GuardedPage {
  click(input: {
    readonly ref: string;
    readonly expectedName: string;
    readonly button?: "left" | "right" | "middle";
    readonly double?: boolean;
  }): Promise<Result<PageActionResult, MutationFailure>>;
  type(input: {
    readonly ref: string;
    readonly expectedName: string;
    readonly text: string;
    readonly clear?: boolean;
    readonly submit?: boolean;
  }): Promise<Result<PageActionResult, MutationFailure>>;
  press(input: {
    readonly key: string;
    readonly ref?: string;
  }): Promise<Result<PageActionResult, MutationFailure>>;
  scroll(input: {
    readonly direction: "up" | "down" | "top" | "bottom";
    readonly ref?: string;
    readonly pages?: number;
  }): Promise<Result<PageActionResult, MutationFailure>>;
}
type PageWait =
  | { readonly kind: "loaded" }
  | { readonly kind: "text"; readonly text: string; readonly present: boolean }
  | { readonly kind: "delay"; readonly milliseconds: number };
type PageActionResult =
  | { readonly kind: "applied"; readonly snapshot: PageSnapshot }
  | { readonly kind: "stale-document" }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-ref" | "occluded" | "not-visible" | "policy";
    }
  | { readonly kind: "closed"; readonly reason: "released" | "reclaimed" | "crashed" };
// close releases only this hold; a session hold can keep a page alive after tab
// close. Policy may reclaim hidden pages, reported as closed/reclaimed. Pages
// do not survive host death by default; persistent cookies do not preserve pages.
// Core browser operations verify expectedName and access policy for both SDK and
// tool calls. unsafe.evaluate needs full automation permission; it is not a read.

async function proposedAdoptAgentPage(
  sdk: Sdk,
  workspaceId: WorkspaceId,
  pageId: PageId,
  viewport: NativePageViewport,
) {
  const capabilityResult = await sdk.workspace(workspaceId).browser();
  if (!capabilityResult.ok) return capabilityResult;
  const capability = capabilityResult.value;
  if (capability.kind !== "available") return capabilityResult;
  const pageResult = await capability.value.adopt(pageId);
  if (!pageResult.ok) return pageResult;
  await using page = pageResult.value;
  await using mounted = await viewport.attach(page.id); // native adapter, not SDK core.
  const snapshotResult = await page.snapshot();
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.value;
  const button = snapshot.nodes.find((node) => node.role === "button" && node.name === "Submit");
  if (button !== undefined) {
    return await page.at(snapshot.revision).click({ ref: button.ref, expectedName: button.name });
  }
}
// NativePageViewport alone owns bounds, occlusion, focus and screenshot fallback.
// Desktop tab stores PageId; URLs are content, never resource identity.

interface TerminalsApi {
  open(input: {
    readonly key: AcquisitionKey;
    readonly columns: number;
    readonly rows: number;
    readonly shell?: string;
  }): Promise<Result<PtyOwner, ResourceOpenFailure>>; // A.
  recover(key: AcquisitionKey): Promise<Result<PtyRecovery, ResourceOpenFailure>>; // A original owner or terminal fact.
  attach(id: TerminalId): Promise<Result<PtyView, ResourceOpenFailure>>; // A output attachment only.
}
type PtyRecovery =
  | { readonly kind: "owned"; readonly owner: PtyOwner }
  | { readonly kind: "ended"; readonly reason: "exited" | "expired" | "host-lost" }
  | { readonly kind: "missing" };
interface PtyOutput {
  readonly id: TerminalId;
  output(): AsyncIterable<Result<PtyFrame, RequestFailure>>;
}
type PtyFrame =
  | { readonly kind: "bytes"; readonly data: Uint8Array }
  | { readonly kind: "gap" }
  | { readonly kind: "exit"; readonly code: number | null };
interface PtyOwner extends PtyOutput, Owned {
  readonly ownership: "process";
  write(bytes: Uint8Array): Promise<Result<void, MutationFailure>>;
  resize(size: {
    readonly columns: number;
    readonly rows: number;
  }): Promise<Result<void, MutationFailure>>;
  idle(): Promise<Result<boolean, RequestFailure>>;
  ended(): Promise<
    Result<
      {
        readonly code: number | null;
        readonly reason: "exited" | "terminated" | "host-lost";
      },
      RequestFailure
    >
  >;
}
interface PtyView extends PtyOutput, Owned {
  readonly ownership: "view";
}
// These interfaces share output, not close semantics. Constructors preserve
// resource kind; an owner cannot safely substitute for a non-owning view.
// Host journals acquisition key/digest before spawn. Retry/recovery returns the
// original acquisition, never a second shell. Connections renew owner leases
// while owner scope is live. Lost replies and abrupt client loss expire within
// a configured bounded lease; recover fences stale owner callbacks. Permanent
// close releases owners; transient disconnect gets only reconnect grace.
// Host loss reports ended/host-lost. Never replay ambiguous starting intent as a
// fresh process under the same key. PtyOwner.close kills the shell and awaits
// cleanup; PtyView.close only detaches. Omitted shell = configured login shell;
// null is rejected. No arbitrary host cwd. code:null = no received exit status,
// not still running. IDs last for the host lifetime unless resumable PTYs are advertised.
// ACK bytes after renderer consumption. One owner stream supplies primary
// backpressure and can pause the PTY. Other views have independent bounded replay
// windows; slow views get gap without stalling owner or peers. Non-pausable
// drivers emit gap even for owners. Owners can read directly, without a second acquisition.

interface JobsApi {
  start(input: {
    readonly command: string;
    readonly key?: CommandKey;
  }): Promise<Result<JobHandle, MutationFailure>>;
  list(): Promise<Result<readonly JobView[], RequestFailure>>;
  get(id: JobId): JobHandle; // S no I/O.
}
interface JobHandle {
  readonly id: JobId;
  info(): Promise<Result<JobView, RequestFailure>>; // Addressed missing job is SdkFailure.missing.
  output(): AsyncIterable<Result<JobOutputFrame, RequestFailure>>;
  background(): Promise<Result<JobActionResult, MutationFailure>>;
  stop(): Promise<Result<JobActionResult, MutationFailure>>;
  settled(options?: RequestOptions): Promise<Result<JobEnd, RequestFailure>>;
}
// Jobs have durable command intent/result, not PTY ownership. Output tab
// open/close cannot stop them. Report processes lost on host shutdown; replay
// only when both recorded policy and environment permit it.

async function proposedTerminal(
  sdk: Sdk,
  workspace: WorkspaceId,
  consume: (bytes: Uint8Array) => Promise<void>,
) {
  const capabilityResult = await sdk.workspace(workspace).terminals();
  if (!capabilityResult.ok) return capabilityResult;
  const capability = capabilityResult.value;
  if (capability.kind !== "available") return capabilityResult;
  const ownerResult = await capability.value.open({
    key: sdk.keys.acquisition(),
    columns: 100,
    rows: 30,
  });
  if (!ownerResult.ok) return ownerResult;
  await using owner = ownerResult.value;
  const written = await owner.write(new TextEncoder().encode("pwd\r"));
  if (!written.ok) return written;
  for await (const frameResult of owner.output()) {
    if (!frameResult.ok) return frameResult;
    const frame = frameResult.value;

    if (frame.kind === "bytes") await consume(frame.data); // Demand resumes after consumption.
    if (frame.kind === "exit") break;
  }
}

// 8. Openers and connectors. Options describe dependencies; open acquires them.

interface HistoryRetentionPolicy {
  readonly leaseMs: number;
  readonly maxLifetimeMs: number;
  readonly maxReaders: number;
}
// All three are positive safe integers, hence finite and bounded.
// leaseMs <= maxLifetimeMs. A reader pins its selected graph only until the
// earlier of its lease deadline and openedAt + maxLifetimeMs. Renewal cannot
// extend the absolute lifetime. maxReaders bounds active reader pins per host;
// excess acquisitions return a typed capacity failure, never unbounded growth.
// Expired readers return snapshot-expired and release pins, including after
// client loss. Collection must honor active reader pins and durable references.
// Session admission/command receipts, withdrawal tombstones and key/digest
// evidence live for the session lifetime, including restart, compaction and archive.
// Workspace and host commands retain that evidence for their respective owner's
// lifetime; deleting a conversation cannot discard a file/Git command receipt.
// There is no automatic receipt expiry. Explicit owner destruction invalidates
// its addresses; a missing owner never permits replay or implicit resurrection.
// Closing a connection, changing workspaces or stopping a host is not deletion.

interface HostOpenOptions {
  readonly store: ResourceInput<NyteOptions["store"]>;
  readonly streamFn: NyteOptions["streamFn"];
  readonly models: ResourceInput<NyteOptions["models"]>;
  readonly model: NyteOptions["model"];
  readonly plugins: NyteOptions["plugins"];
  readonly defaultWorkspace: NyteOptions["defaultWorkspace"];
  readonly historyRetention: HistoryRetentionPolicy;

  readonly onDiagnostic?: NyteOptions["onDiagnostic"];
  readonly drain?: NyteOptions["drain"];
  readonly actor?: NyteOptions["actor"];
  readonly thinkingLevel?: NyteOptions["thinkingLevel"];
  readonly compaction?: NyteOptions["compaction"];
  readonly streamOptions?: NyteOptions["streamOptions"];
  readonly cacheWarming?: NyteOptions["cacheWarming"];
  readonly telemetry?: NyteOptions["telemetry"];
  readonly workspace?: NyteOptions["workspace"];
  readonly trust?: NyteOptions["trust"];
}
// These indexed types reuse the existing dependency contracts, not a second
// generic composition API. No constructor acquires resources implicitly.
// Grounding: NyteOptions requires store, streamFn, models, model, plugins and
// defaultWorkspace. HostOptions supplies catalog/streaming from MutableModels;
// that convenience does not make model execution or an initial model optional.
// streamFn and callbacks are borrowed. plugins are prepared definitions; core
// owns the connections, plugin tasks and pools it acquires during activation.
// Exactly one environment provider must serve defaultWorkspace.kind. Reject
// duplicate providers; local cwd must be absolute and workspace identity match.
// Project plugin loading stays behind trust. The source trust default remains
// trusted for defaultWorkspace, requires/workspace_trust for other workspaces.
// Core owns the vocabulary: WorkspaceTrust is the answer, WorkspaceTrustMode
// ("ask" | "always" | "never") is how a host reaches it. The host store applies
// the mode where no grant exists: "ask" trusts a folder without project input
// and asks for one with it; "always" trusts with the input; "never" trusts and
// marks TrustedWorkspace.projectInput false, so the folder runs on user plugins
// and skills alone and nothing asks. A user setting a project cannot set.
// Browser, PTY, files and Git are environment/plugin capabilities. Chat-only and
// nonlocal hosts need no universal browser driver, PTY driver or native service.
// These optional tuning fields retain source omission semantics; no new nulls.

interface NyteHost extends Owned {
  readonly sdk: Sdk;
  readonly execution: ExecutionApi;
  readonly admin: HostAdminApi;
  listen(options: ListenOptions): Promise<Result<Listener, ResourceOpenFailure>>; // A owns listener, borrows host.
}
interface NyteConnection extends Owned {
  readonly sdk: Sdk;
}
interface Listener extends Owned {
  readonly address: string;
  disconnectClients(): Promise<Result<void, MutationFailure>>; // Observation/requests, not durable runs.
}
declare const Nyte: {
  open(options: HostOpenOptions): Promise<Result<NyteHost, HostOpenFailure>>; // A acquires owned dependencies.
  connect(options: ConnectOptions): Promise<Result<NyteConnection, ConnectionFailure>>; // A handshake and journal worker.
};
type ConnectOptions = {
  readonly transport:
    | { readonly kind: "http"; readonly url: string; readonly fetch?: typeof fetch }
    | { readonly kind: "ipc"; readonly channel: ResourceInput<ClientChannel> };
  readonly credentials: CredentialSource;
  readonly journal: JournalProfile;
};
type JournalProfile =
  | { readonly kind: "memory" }
  | { readonly kind: "persistent"; readonly adapter: ResourceInput<RequestJournalAdapter> };
// No global journal or mutable selected host. Persistent adapters bind permanently
// to handshake HostId + authenticated principal. Stop workers before closing
// owned journal/channel; fetch and credential functions are borrowed. Client close
// does not sign out. Refresh preserves identity; host/principal changes require
// a new connection. Session selection is not a token or authorization boundary.

type ExecutionCoverage =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionId[] };
interface ExecutionApi {
  cover(input: ExecutionCoverage): Promise<Result<Owned, ResourceOpenFailure>>; // A includes future heads/children.
  advance(
    input: { readonly session: SessionId; readonly head: HeadName },
    options?: RequestOptions,
  ): Promise<Result<AdvanceReport, MutationFailure>>;
  repair(input: {
    readonly cursor?: Cursor;
    readonly limit: number;
  }): Promise<Result<RepairPage, MutationFailure>>;
}
type AdvanceReport =
  | { readonly kind: "continue" }
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly until: number | null }
  | { readonly kind: "retry"; readonly until: number }
  | { readonly kind: "busy"; readonly until: number }
  | { readonly kind: "fenced" };
// until:null = durable wait without a timer; its wake obligation remains.
// All drivers share kernel reconciliation of jobs/delegation/input yields and
// the same advance, including local coverage, CF alarms and Vercel Workflow.
// all/workspace coverage includes future sessions and heads. Running listeners
// acquire coverage before accepting requests; close releases it, not durable
// Stop, and other coverage may remain. Admission-only listeners advertise
// uncovered; accepted work need not progress. Repair before following live wake
// events so pre-subscription events cannot strand work. Cloud schedulers persist
// the next repair obligation before releasing invocation. Dispatch is not
// completion; bounded runnable-head repair is required.

interface HostAdminApi {
  session(session: SessionId): SessionDiagnostics; // S binds identity; reads below perform I/O.
  relocate(input: {
    readonly session: SessionId;
    readonly workspace: WorkspaceId;
  }): Promise<Result<RelocateResult, MutationFailure>>;
  reactivate(): Promise<Result<void, MutationFailure>>;
  replacePlugins(
    input: PluginReplacementInput,
  ): Promise<Result<PluginReplacementResult, MutationFailure>>;
  checkPlugins(input: PluginReplacementInput): Promise<Result<PluginCheckReport, RequestFailure>>; // O same preflight, activates nothing.
  warming: CacheWarmingAdministration;
  retention: RetentionAdministration;
  readonly unsafe: HostUnsafe;
}
interface PluginReplacementInput {
  readonly key: CommandKey;
  readonly plugins: NyteOptions["plugins"];
  readonly session?: SessionId; // omit = host-wide; one session otherwise.
}
type PluginLoadOutcome =
  | {
      readonly kind: "activated";
      readonly plugin: PluginInfoView;
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly kind: "rejected"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | {
      readonly kind: "kept-previous";
      readonly plugin: PluginInfoView;
      readonly issues: readonly ValidationIssue[];
    };
interface PluginReplacementResult {
  readonly key: CommandKey;
  readonly generation: CatalogGeneration;
  readonly plugins: readonly PluginLoadOutcome[];
}
interface PluginCheckReport {
  readonly plugins: readonly PluginLoadOutcome[];
  readonly counts: {
    readonly commands: number;
    readonly tools: number;
    readonly settings: number;
    readonly agents: number;
  };
  readonly collisions: readonly ValidationIssue[]; // warnings naming both owners.
}
// Load rules, per plugin: a declaration with an error issue is skipped and the
// rest of that plugin still activates; a plugin whose definition cannot be
// parsed at all is rejected, and on replacement its previous version stays
// active as kept-previous. The host never ends up with no plugins because one
// reload was bad. Issues that need the running host, such as a command name
// already owned by another plugin or a model the catalog lacks, are warnings
// in the check report and carry both sources. The check report is static: it
// runs the same preflight Nyte.open runs, without opening a database, reaching
// a provider or activating a session. Same-id replacement across sources
// (builtin < user < project < inline) is reported as a warning naming the
// shadowed plugin, never applied silently.
interface SessionDiagnostics {
  refs(): Promise<Result<readonly RefView[], RequestFailure>>;
  objects(input?: {
    readonly cursor?: Cursor;
  }): Promise<Result<Page<DecodedObjectView>, RequestFailure>>;
  events(input: { readonly after: Seq }): AsyncIterable<Result<DurableEventView, RequestFailure>>;
  verify(): Promise<Result<IntegrityReport, RequestFailure>>;
}
interface HostUnsafe {
  // Local only; requires host authority, not a remote capability bit.
  withStore<Success, Failure>(
    use: (store: StoreAuthority) => Promise<Result<Success, Failure>>,
  ): Promise<Result<Success, Failure | RequestFailure>>;
  withLease<Success, Failure>(
    input: { readonly session: SessionId; readonly head: HeadName },
    use: (lease: ExecutionLease) => Promise<Result<Success, Failure>>,
  ): Promise<Result<Success, Failure | RequestFailure>>;
}
// Escape hatches support storage-driver/tool/runtime authors, not pool classes,
// window internals, SQL strings or mutable cached rows. Raw writes can pass CAS
// yet violate SDK semantics. Examples require exclusive maintenance authority
// for repairs/adapters, not UI use. SessionDiagnostics, Store, Execution and
// HostAdmin are local-only. Remote /tree uses retained domain reads, not raw objects.
// HostUnsafe preserves the callback's failure union and does not classify thrown
// callback defects. It validates authority and acquires the lease before calling
// use; missing/busy ownership returns a failure without running the callback.
// These maintenance escapes never bypass storage fencing.

// Nyte.open first validates option schemas, retention bounds, duplicate provider
// registrations and local paths without opening a database or reaching a provider.
// Once a dependency opens, validate its identity/capabilities before using it.
// The host closes everything acquired on failure, in reverse dependency order.
// Expected setup failures return Result; rollback failures reject AggregateError
// containing the primary failure and all cleanup causes. No empty-store fallback.
// A borrowed dependency is never closed. Concurrent close calls share settlement.

interface NativeCompositionInput {
  readonly database: string;
  readonly models: NyteOptions["models"];
  readonly streamFn: NyteOptions["streamFn"];
  readonly model: NyteOptions["model"];
  readonly workspace: NyteOptions["defaultWorkspace"];
  readonly plugins: NyteOptions["plugins"];
  readonly historyRetention: HistoryRetentionPolicy;
  readonly trust?: NyteOptions["trust"];
}
declare const Stores: {
  openSqlite(input: {
    readonly path: string;
  }): Promise<Result<NyteOptions["store"] & Owned, ResourceOpenFailure>>;
};

function proposedNativeComposition(input: NativeCompositionInput): HostOpenOptions {
  return {
    store: { kind: "owned", open: () => Stores.openSqlite({ path: input.database }) },
    models: { kind: "borrowed", value: input.models },
    streamFn: input.streamFn,
    model: input.model,
    plugins: input.plugins,
    defaultWorkspace: input.workspace,
    historyRetention: input.historyRetention,
    ...(input.trust === undefined ? {} : { trust: input.trust }),
  };
}
// Substitute a borrowed Store, or an owned PostgreSQL/worker factory with the
// same typed contract. Platform SQLite stays borrowed. Owned PostgreSQL closes
// its pool. Catalog/provider tasks, MCP pools and telemetry acquired by core
// close with core; externally supplied objects keep their own lifetime.

async function proposedNativeOpen(
  input: NativeCompositionInput,
): Promise<Result<void, HostOpenFailure>> {
  const options = proposedNativeComposition(input); // S, no acquisition.
  const opened = await Nyte.open(options); // A, acquisition and validation.
  if (!opened.ok) return opened;
  await using host = opened.value;
  // host.sdk is admission-only until explicit execution coverage is acquired.
  return { ok: true, value: undefined };
}

// An internal function can name exactly the capability it needs. This is an
// ordinary parameter, not a required Handler<A, E, R> convention. Dependencies
// may also be constructor arguments or a closure where that is simpler.
async function proposedNativeProgram(
  sdk: Pick<Sdk, "session">,
  session: SessionId,
  content: UserContent,
  options: SubmitOptions,
): Promise<Result<AdmittedInput, AdmissionFailure>> {
  return sdk.session(session).queue(content, options);
}
// Core binds the canonical handlers to concrete store/model/policy dependencies.
// Local SDK calls and authorized listeners reach those same handlers. No fake
// local HTTP route, interpreter, service tags or implicit retry. Capture a key
// before retrying; a fresh invocation without a key is a fresh submission.

interface OperationResults {
  readonly navigate: NavigationOutcome;
  readonly edit: EditOutcome;
  readonly compact: CompactResult;
  readonly configure: ConfigurationReceipt;
  readonly "job-start": JobView;
  readonly "session-create": SessionInfoView;
  readonly branch: BranchRecord;
  readonly "file-save": FileWriteResult;
  readonly "git-write": GitMutation;
  readonly "plugin-setting": SettingResult;
  readonly "plugin-command": PluginCommandResult;
  readonly "plugin-replace": PluginReplacementResult;
  readonly "file-batch": FileBatchResult;
  readonly restore: RestoreResult;
}
// Excerpt of the generated result map, which includes every keyed declaration,
// including lifecycle/admin mutations. Results contain no JS methods; branch/job/create
// adapters bind returned domain IDs to handles after decoding stored results.
interface OperationsDirectory {
  find<K extends keyof OperationResults>(input: {
    readonly kind: K;
    readonly key: CommandKey;
  }): Promise<Result<Lookup<Operation<OperationResults[K]>>, RequestFailure>>;
}
// Stored command kind must match the requested kind; the schema validates it.
// All command kinds obey same-key/same-digest replay and KeyConflict otherwise.
// Core charges/retries summarization by the command record, not by UI request count.

type ListenOptions = {
  readonly transport: ServerTransport;
  readonly authorization: ServingPolicy;
  readonly execution:
    | { readonly kind: "run"; readonly coverage: ExecutionCoverage }
    | { readonly kind: "admit-only" };
};
type ResourceInput<T> =
  | { readonly kind: "borrowed"; readonly value: T }
  | {
      readonly kind: "owned";
      readonly open: () => Promise<Result<T & Owned, ResourceOpenFailure>>;
    };
// Constructors unwind partial acquisitions; borrowed objects never close implicitly.

type OperationDeclaration<Input, Output, Failure> = {
  readonly input: DomainSchema<Input>;
  readonly output: DomainSchema<Output>;
  readonly failure: DomainSchema<Failure>;
  readonly authority: "participant" | "execution" | "administration";
} & (
  | { readonly execution: "query" }
  | { readonly execution: "observation" }
  | {
      readonly execution: "mutation";
      readonly recovery: {
        readonly kind: "keyed";
        readonly identity: "submission" | "command" | "session" | "acquisition";
        readonly publication: "atomic" | "checkpointed" | "leased-acquisition";
      };
    }
  | {
      readonly execution: "mutation";
      readonly recovery: {
        readonly kind: "convergent";
        readonly state: DomainStateAddress;
      };
    }
  | { readonly execution: "volatile-action"; readonly retry: "never" }
);
// Mutations require recovery policy. Keyed handlers require normalized identity,
// even if the caller method mints it. The boundary journals, compares digests and
// preserves failure identity. Convergent writes such as seen marks need no receipt
// per scroll tick, but must converge on the declared state key. Never automatically
// replay volatile PTY input/resize or browser actions. Failures identify target/attempt;
// Read state before resending. Durable writes cannot be identity-free.
// This describes the catalog, not a schema framework. Use a concrete schema library
// with parsers as source of truth. Generate codecs, dispatch, client typings and
// capability metadata from domain declarations; explicitly adapt resource handles.
// Result error types and boundary codecs derive from the same failure schemas.
// Success schemas describe wire records, not resource handles. Generated adapters
// bind those records to local handles explicitly. Never serialize secrets,
// dependency objects, closures, AbortSignal or native objects.

interface EnvironmentProvider {
  provision(input: {
    readonly workspace: WorkspaceId;
    readonly key: CommandKey;
  }): Promise<Result<EnvironmentBinding, ResourceOpenFailure>>;
  connect(binding: EnvironmentBinding): Promise<Result<EnvironmentConnection, ResourceOpenFailure>>;
  suspend(binding: EnvironmentBinding): Promise<Result<void, MutationFailure>>;
  destroy(input: {
    readonly workspace: WorkspaceId;
    readonly binding: EnvironmentBinding | null;
  }): Promise<Result<void, MutationFailure>>;
}
interface EnvironmentConnection extends Owned {
  readonly id: EnvironmentId;
  readonly capabilities: EnvironmentCapabilities;
}
// provision adopts by stable workspace identity after crashes or competing creates.
// binding is serializable locator data without credentials, not a live handle.
// destroy binding:null = no recorded binding; find pre-crash resources by workspace
// identity and clean them. Connection close does not end billing. Local providers
// may reject destroy for user directories; host scope release never recursively
// removes a user's workspace.

// Connector ownership:
// - Stores.sqlite/worker/postgres: scope owns acquired connection/pool/worker.
// - Stores.from(connection): explicit borrowed or scoped factory, never infer.
// - Stores.cloudflare(storage): platform borrowed; host closes session views only.
// - Models.configured: provider transports and refresh tasks scoped; credentials
//   persist under a separate explicit store, no module-global auth mutation.
// - Plugins.from/source: parsed definitions + runtime scope; project load behind trust.
// - Mcp.open: stdio and streamable HTTP pools scoped; acquisition yields typed status.
// - Codemode.open: sandbox per invocation, parent scope supervises worker resources.
// - Telemetry.open: flush after execution settlement, then exporter shutdown.
// - Machine.open: provider sign-in/GitHub/settings/usage; account attempts scoped.
// - Broker.connect: account enrollment and verified device credential, not inference.
// - Relay.connect: socket/credits/leases, scope closes channels; never runs model work.
// - Listener.http/ipc: parsed authorized calls -> same core handlers, close leaves
//   accepted work intact. serve static web shell remains a host entry, not core.
// - CF driver: platform alarms + keyset repair + core advance, no permanent worker.
// - Vercel driver: Workflow waits + core advance + persistent repair; no early
//   deletion of the only work obligation when Workflow merely started.
// - Electron driver: browser/PTY implementations; viewport remains local adapter.
// - Remote sandbox: environment provider lifecycle above; explicit destroy owns cost.

interface ModelDirectory {
  list(): Promise<Result<readonly ModelInfoView[], RequestFailure>>;
  default(): Promise<Result<Lookup<ModelInfoView>, RequestFailure>>;
}
interface AdministrationCapabilities {
  machine(): Promise<Result<Capability<MachineApi>, RequestFailure>>;
}
interface MachineApi {
  readonly providers: ProviderAdministration;
  readonly github: GitHubAdministration;
  readonly settings: SettingsAdministration;
  readonly usage: UsageAdministration;
}
interface ProviderAdministration {
  catalog(): Promise<Result<ProviderCatalogView, RequestFailure>>;
  login(input: {
    readonly provider: string;
    readonly method: LoginChoice;
    readonly key: CommandKey;
  }): Promise<Result<LoginAttemptHandle, ResourceOpenFailure>>;
  logout(provider: string): Promise<Result<void, MutationFailure>>;
  preferences(change: ModelPreferenceChange): Promise<Result<ProviderCatalogView, MutationFailure>>;
}
interface LoginAttemptHandle extends Owned {
  readonly id: string;
  states(): AsyncIterable<Result<LoginAttemptView, RequestFailure>>;
  answer(code: string): Promise<Result<void, MutationFailure>>;
}
// Releasing the login handle cancels this attempt, not a saved account. Account connection
// grants neither workspace trust nor terminal/browser/credential access to all
// authenticated remote callers.

interface PluginReadApi {
  list(): Promise<Result<readonly PluginInfoView[], RequestFailure>>;
  readonly commands: {
    list(): Promise<Result<readonly CommandInfoView[], RequestFailure>>;
    run(input: {
      readonly name: string;
      readonly arguments?: string | Json; // text commands take a string; schema commands take Json.
      readonly key: CommandKey;
    }): Promise<Result<PluginCommandResult, CommandFailure>>;
  };
  readonly settings: {
    list(): Promise<Result<readonly SettingInfoView[], RequestFailure>>;
    apply(input: {
      readonly id: string;
      readonly choice: string;
      readonly key: CommandKey;
    }): Promise<Result<SettingResult, MutationFailure>>;
  };
  resources(): Promise<Result<readonly SkillView[], RequestFailure>>;
  status(): AsyncIterable<Result<readonly StatusItemView[], RequestFailure>>;
}
interface CommandInfoView {
  readonly name: string; // owner-qualified; bare names are the owner's own.
  readonly owner: string;
  readonly title: string; // palette text.
  readonly description: string;
  readonly category?: string;
  readonly keywords?: readonly string[];
  readonly arguments:
    | { readonly kind: "text" }
    | { readonly kind: "schema"; readonly schema: JsonSchema };
  readonly selection: "run" | "insert";
}
type PluginCommandResult =
  | { readonly kind: "ran"; readonly output?: Json }
  | { readonly kind: "prompt"; readonly prompt: UserContent }
  | { readonly kind: "failed"; readonly message: string };
interface SettingInfoView {
  readonly id: string;
  readonly owner: string;
  readonly label: string;
  readonly choices: readonly [SettingChoiceView, ...SettingChoiceView[]];
  readonly current: {
    readonly choice: string;
    readonly from: "default" | "host" | "session"; // the layer that set it.
  };
}
type SettingChoiceView = { readonly id: string; readonly label: string; readonly status?: string };
// A command is a typed action, not a free-text slash entry. arguments:text keeps
// today's `/name rest of line`; arguments:schema lets the palette, CLI and
// remote callers reject a bad call as invalid-input with issues before run,
// e.g. `no argument named "bogus"; the command takes file, ratio?`. Commands
// are keyed mutations: a nested run from inside a command reuses the parent's
// key space and nests at most 16 deep. Two plugins declaring one name is a
// warning naming both; the later source wins, as with plugin ids. Missing name
// is unavailable, not not_found. Only hosts register plugins; remote
// listing/commands cannot upload JS. Schemas define tool arguments/results.
// Declarations persist; executable closures remain installed code. Each call
// supplies its tool environment. Settings that affect requests are captured
// into the input choice at admission; from says which layer a client is
// changing when it applies a choice.

function proposedToolDefinition() {
  return Tool.define({
    name: "read_file",
    parameters: Schemas.readFile,
    result: Schemas.fileDocument,
    failure: Schemas.fileReadFailure,
    replay: { kind: "safe", environment: "same" },
    execute: (arguments_, invocation) => invocation.files.read(arguments_.path),
  });
}
// Invocation supplies exact run/call/env identity, deadline/signal, durable wait,
// progress and policy-routed nested tools. It expires at invocation end; detached
// callbacks cannot publish through stale leases. Uncertain external effects require
// replay never, not default safe. Waiting stores generation/data; wake re-enters code,
// not a JS continuation. Nested tools use model-issued calls' policy. Typed extension
// methods still require parsed authorization.

// Delegation is a core invocation capability, not an untyped participant route.
type InvocationFiles = Pick<FilesApi, "read">;

interface ToolInvocation {
  readonly run: RunId;
  readonly call: CallId;
  readonly environment: EnvironmentId;
  readonly signal: AbortSignal;
  readonly agents: DelegationApi;
  readonly tools: PolicyRoutedTools;
  readonly files: InvocationFiles;
}
interface DelegationApi {
  create(input: {
    readonly key: CommandKey;
    readonly title?: string;
    readonly system?: string;
    readonly configuration?: InputChoice;
  }): Promise<Result<ChildAgent, ConfigurationFailure>>;
  task(input: {
    readonly key: CommandKey;
    readonly prompt: UserContent;
    readonly configuration?: InputChoice;
    readonly waitMs?: number;
  }): Promise<Result<ChildTaskObservation, AdmissionFailure>>;
  get(child: SessionId): ChildAgent; // S lineage checked when used; no new child.
  join(input: {
    readonly children: readonly SessionId[];
    readonly mode: "any" | "all";
    readonly timeoutMs: number;
  }): Promise<Result<ChildObservation, RequestFailure>>;
}
interface ChildAgent {
  readonly id: SessionId;
  send(input: {
    readonly key: SubmissionKey;
    readonly message: UserContent;
    readonly waitMs?: number;
  }): Promise<Result<ChildTaskObservation, AdmissionFailure>>;
  read(input?: { readonly turns?: number }): Promise<Result<ChildObservation, RequestFailure>>;
  stop(input: { readonly run: RunId }): Promise<Result<StopResult, MutationFailure>>;
}
interface ChildTaskObservation {
  readonly child: SessionId;
  readonly admission: AdmissionRecord;
  readonly observation: ChildObservation;
}
type ChildObservation =
  | { readonly kind: "working"; readonly run: RunId }
  | { readonly kind: "waiting" }
  | { readonly kind: "settled"; readonly report: UserContent }
  | { readonly kind: "deadline" };
// create links a child session, not a conversation branch or history copy. Core
// records parent run/call, child request and a one-time continuation grant. Child
// completion alone cannot restart the parent. Parent Stop revokes the grant but
// leaves child work running unless explicitly stopped by exact identity.
// join parks a durable effect generation, not a JS continuation. Invocation
// methods return closed after end; later invocations reacquire by child ID. Serialized
// closures cannot transfer authority. Delegated input obeys configuration, chain
// budget, replay environment and same-key digest rules; fresh roots cannot evade
// budget. System/title/choice/waitMs/turns default when omitted, never accept null.
// timeoutMs is required, not undefined for "wait forever". Participants check
// children and use exact-run controls; only verified invocations can grant
// automatic parent continuation.

function proposedDelegatingTool(invocation: ToolInvocation, key: CommandKey, prompt: UserContent) {
  return invocation.agents.task({ key, prompt, waitMs: 30_000 });
}
// Plugin tools and custom host invocations share DelegationApi. Existing
// task/create/send/await/read/stop descriptions become adapters, not exclusive access.

// Retained connectors and escapes:
// @nyte-ai/ai stays public for direct models.stream/complete/deferred/provider
// compaction and eight provider factories. Direct calls have no durable history
// or tool-effect guarantees; host code owns signals/resources. Provider authors
// retain OAuth objects/device-code pollers. Products use MachineApi attempts
// with separately scoped credential storage. WebSearch.open installs
// Exa/Firecrawl/Parallel/Tavily and credential callbacks in host scope, apart from MCP.
// Tunnel.open owns CloudflareTunnelPlugin-style device authorization/exposure:
// prepare exposure -> bind listener with its auth -> start connector. Revoke ends
// authorized streams and refuses future credentials. Close neither clears devices
// nor stops accepted inference; explicit clear removes credentials. Cloudflare/broker
// TLS termination can see plaintext. ConnectWorker owns broker fetch/scheduled/
// EnvironmentRelay DO callbacks as platform roots, not Nyte.close or model execution.
// Store/image-resize/codemode/usage workers remain distinct executable adapter assets,
// started/stopped by their owning adapter, not arbitrary SDK methods. TUI Host.open
// and web/mobile enrollment compose owned host scope and verified connections,
// explicitly releasing credentials on persistence failure. TelemetryContext/
// createOtelTelemetry stay public. Borrowed tracers acquire no exporter;
// Telemetry.open owns only resources it opens.

// 9. Nullability and chaining contract.
//
// Optional request fields
//   SubmitOptions.key                mint once; repeated SDK call is new input.
//   SubmitOptions.history            capture observed epoch; otherwise preflight read, never retry rebind.
//   SubmitOptions.configuration      capture selected choice in admission CAS.
//   configuration.kind                required patch|exact discriminant.
//   ExactChoice agent:null            built-in agent value, not a reset.
//   ExactChoice policy version        required and validated, never discarded.
//   ChoicePatch.model                keep current model; null rejected.
//   ChoicePatch.thinking / agent      keep override; null explicitly clears it.
//   requestPolicy.fast                keep; null reset to resolved provider default.
//   requestPolicy.settings            keep; provided registered choices merged and validated.
//   Sessions.create.id/name/workspace default as documented; null rejected.
//   Session.update.name              keep if omitted; null clears title.
//   Session.update booleans          unchanged if omitted; null rejected.
//   list cursor/limit/parents         first page/default bound/all if omitted.
//   pending.revise fields            retain each omitted value; no null accepted.
//   compaction/acquisition key        required; lost replies reconcile by key.
//   summary instructions            host default summarization instructions.
//   files directory/ignored/limit    workspace root/exclude/default bound.
//   browser button/double/clear/submit left/false/false/false.
//   browser ref/pages/console.limit  viewport/default page distance/default cap.
//   browser console.clear            false; true is an explicit buffer mutation.
//   terminals.shell                  configured login shell.
//   RequestOptions.signal            no caller signal; never durable Stop.
//   Connect HTTP fetch               standard fetch adapter.
// Optional TS values do not serialize as undefined. Encoders omit optional members.
//
// Unknown members and variants
//   Request schemas reject unknown members as invalid-input. A misspelled
//   argument is an error, never ignored.
//   Views and frames tolerate unknown members: a client ignores fields it does
//   not know, so a newer host can add data without breaking older clients.
//   An unknown discriminant is a whole-frame problem. A client skips that frame
//   or view and refetches; it never coerces an unknown kind into one it knows,
//   so a state added later cannot read as an older state. Event names are not
//   checked against a list; subscribing to a name this host never emits is
//   allowed and receives nothing.
//   Settings files and plugin storage read per key: a bad value falls back for
//   that key alone and unknown keys are kept on write.
//
// Known nullable facts
//   page.next                        end of pagination.
//   HistoryNode.parent               conversation root.
//   ResolvedChoice.agent             built-in/default agent.
//   ExecutionView.idle.last          no previous run.
//   ParkedWait.deadline              no timer.
//   NavigationOutcome.summary        no summary published.
//   post-stop failure.stoppedRun     no preceding Stop committed.
//   SessionView selected/effective     no selected configuration/no effective request yet.
//   not-attempted identity             no write identity minted, not an unknown write.
//   DeliveryEntry.state()            no locally journaled record.
//   Git.snapshot.head                unborn Git repository.
//   PTY code                         no exit code observed.
//   EnvironmentProvider.destroy.binding no stored reconnect locator.
//   SessionView/HeadInfoView.unseen  nothing drawn after the seen mark.
//   HeadInfoView.stack               not stacked.
//   TurnView.run / failure           seeded or foreign turn / ended normally.
//   user part key / source           sender gave no key / unattributed.
//   tool part result / output        no result commit landed / returned nothing.
// None means loading, unsupported, or "please choose a default" unless explicitly
// declared as a patch clear operation above.
//
// Chain-now S
//   sdk.session(id).head(name).run(id); sdk.workspace(id); page.at(revision);
//   git.at(revision); changes.batch(...).put(...).remove(...); ID parsing and host option construction.
//   .head takes a parsed SideHeadName; main is already the session handle.
//   .branch is not chain-now. It mutates named history and returns an outcome.
// Await-first A
//   Nyte.open/connect; sessions.create; observe/tree; files.bytes/scan;
//   browser.open/adopt; terminals.open/attach; listener and execution.cover.
// Outcome O
//   queue/steer/configure; branch; navigation/edit admission; every guarded write;
//   stop/reply/input.withdraw; markSeen; lookup/state reads; operation.settled/graph.renew.
// Stream W
//   observation.frames/events; graph.pages; scan.pages; bytes.chunks;
//   file watch/search; browser.states; PTY/job output; login states.
// No lazy-program category. Operations start when called. Builders remain
// immutable values until their documented apply/open call.
//
// Invalid chains and substitutions:
//   Nyte.open(options).sdk              // await acquisition first.
//   (await Nyte.open(options)).sdk      // narrow Result, then use value.sdk.
//   sdk.session(id).queue(text).stop()   // Promise is not AdmittedInput or Run.
//   (await session.queue(text)).runId   // narrow Result; receipt still has no run until landing.
//   session.branch(...).queue(text)     // narrow created outcome, then head.
//   git.at(oldRevision).stage(...).push(...) // a receipt is not a fresh revision.
//   sdk.workspace(id).browser?.open(...) // no optional namespace.
//   closeView()                         // never shorthand for run.stop().
//   anchors.set(head, view.seen)        // a seen mark is not a scroll position.
//
// Export policy
//   Export domain capabilities, driver contracts, pure projections, parsers and
//   documented diagnostic and maintenance escapes needed by custom hosts, not private
//   caches/pools. Callers need no runner callback knowledge after parking tools.
//   Broad domain access does not require more resource owners.

// Part III. Rationale, impact and verification

/**
 * Problem and decision
 *
 * Missing SDK contracts leave products reading stores for /tree, coordinating
 * configuration with input, and implementing native resource behavior. Core will
 * own these contracts; drivers, transport and native views keep their boundaries.
 *
 * Core owns operations and resources, pinned graph reads and durable receipts.
 * Expected failures are typed Results. Requirements are actual TypeScript
 * parameters, including explicit host dependencies. Execution uses normal
 * Promises. No Effect runtime, library, adapters or Layer composition is adopted,
 * and no mini runtime or mandatory generic internal abstraction replaces them.
 * Existing kernel effects and PluginScope remain; neither is the Effect library.
 * This changes core admission, navigation, history and environment contracts.
 * Migrate callers and delete old behavior paths without compatibility aliases.
 */

/**
 * Rejected from candidate A
 *
 * - Mandatory unstable effect/rpc/WebSocket framing. Existing HTTP/SSE, Connect
 *   relay and non-TS clients do not need it. Domain schemas own wire meaning;
 *   bounded HTTP streams can rebase.
 * - Generic Promised<T> mapping. It loses multi-argument, optional and overloaded
 *   method semantics and cannot infer scope ownership from arbitrary objects.
 *   Derive known operation bindings and implement resource acquisition explicitly.
 * - Configure-before-input batching without compatible-drain rules. Later config
 *   could affect earlier messages. Persist resolved input choices.
 * - "Lossless" conflated observations. Retained durable events replay; snapshots
 *   converge, but intermediate views and transient deltas may be skipped.
 * - Unbounded graph arrays. Use coherent, pinned paged reads.
 * - Cancellation that claims to undo every write. Request, wait, command and run
 *   scopes differ from irreversible Stop and must be modeled separately.
 */

/**
 * Rejected from candidate B
 *
 * - Renaming core to harness behind a new SDK package hierarchy. A harness
 *   configures core; core still owns the contracts.
 * - Requiring input(...).using(...).queue({}) for every message. One queue/steer
 *   operation captures choice, with exact defaults for optional fields.
 * - Read-only .branch(name). .head(name) binds; .branch creates.
 * - Removing all local store access. Drivers and repair tools need documented,
 *   authority-restricted access; remote clients do not get it.
 * - Capability booleans. Unsupported, denied and temporarily unavailable differ.
 */

/**
 * Taken from Rex
 *
 * Rex's init.lua declares four things: key bindings, actions, hosts and log
 * lines. Everything else is runtime API that actions call later. What carried
 * over, and where it landed:
 *
 * - Actions declare argument types, and a wrong call is refused before it
 *   runs. CommandInfoView.arguments and the keyed commands.run (Part II §8).
 * - `rex config check` reports each mistake with severity and file:line, skips
 *   a bad declaration while loading the rest, and keeps the last working load
 *   when the whole file fails. ValidationIssue (§2), PluginCheckReport and
 *   PluginLoadOutcome (§8).
 * - `rex keymap` prints the merged result with a SOURCE column, and a collision
 *   warns naming both bindings. SettingInfoView.current.from and collision
 *   warnings on same-id or same-name plugins (§8).
 * - Inputs are strict (`additionalProperties: false`), events and reports are
 *   lenient, and an unknown state discards the whole report rather than
 *   reading as an old state. The unknown-members rule (§9).
 * - `rex api list/describe --json` serves the server's own schemas, examples
 *   and validation notes, and the CLI and Lua bindings derive from it. The
 *   runtime sdk.catalog() over the same OperationDeclaration data (§4).
 * - `keymap_changed{generation}` after a reload. catalog-changed and
 *   plugins-changed host frames replace client-side plugin invalidation (§4).
 */

/**
 * Rejected from Rex
 *
 * - Key bindings, sequences and modes in core. They are client UI. A desktop
 *   keymap lives in desktop settings and binds keys to command names; the only
 *   thing it needs from core is that commands are nameable and typed.
 * - Configuration as a script. settings.json stays lenient data; plugins stay
 *   code loaded behind trust. Rex already refuses config reloads over a remote
 *   connection, which matches "only hosts register plugins".
 * - `rex.client.queue`, where an action asks the client to perform UI actions
 *   after it returns. CommandOutcome.prompt is the only handback. The host does
 *   not drive client UI.
 * - Function bindings that fall through on false, label-based targeting with
 *   ambiguity exits, and host declarations. CLI concerns, or already covered by
 *   HostId and the connect store.
 * - `ctx.origin` (key/palette/cli/api). A command does not behave differently by
 *   who invoked it; authorization already runs per principal.
 *
 * Outside the schema: Rex's OSC 7501 program-status protocol (working, blocked
 * with kind permission/question/auth, done, error) maps onto our execution
 * view, the question tool and provider login. The TUI should emit it and
 * desktop terminals should read it. That is a TUI/desktop change, not an SDK one.
 */

/**
 * Operation ownership
 *
 * queue/steer own choice capture, idempotency, routing and wake obligation.
 * navigate/edit own summary, exact Stop, revalidation, publication and handback.
 * observe owns snapshots/events; transport owns reconnect recovery.
 * tree owns retained graph coherence and GC pinning.
 * browser owns page identity, policy and ref generations. terminal owns process
 * and output lifetimes. ID currying alone removes none of this coordination.
 */

/**
 * Accepted tradeoffs
 *
 * - Host dependencies and owned-resource cleanup are explicit in ordinary
 *   TypeScript parameters and Promise code, without a runtime service container.
 * - Explicit host/client separation prevents connecting from granting a runner.
 * - Command records preserve edit, summary and file outcomes after a UI request
 *   disappears. They use current objects/refs rather than another engine.
 * - Per-input configuration snapshots preserve the user's selected model;
 *   batching admits only inputs with compatible captured choices.
 * - Consistent graph reads require a bounded, renewable retention lease under
 *   host policy. Admission and command receipts remain for the session lifetime.
 * - Local filesystem operations can have partial outcomes.
 * - One low-level local maintenance entry restricts mutations by authority.
 */

/**
 * Other alternatives
 *
 * - Session/head wrappers alone leave apps owning queues and internal store reads.
 * - A UI-owned live session controller centralizes wiring for one product but
 *   puts core semantics in that product. Custom harnesses and CI still need them.
 * - A library-owned wire, schema, workflow and SDK would replace working durable
 *   authority and require other languages to implement library-specific framing.
 *   Keep the existing durable authorities and portable domain contracts.
 * - Collapsing packages into core removes directories, not their dependency
 *   constraints. Browser clients, provider connectors and native runtimes differ.
 */

/**
 * Seen-mark rationale
 *
 * Use position, not time. transcript.ts:284 records that a host clock can step
 * backwards mid-turn. app/session-read-state.ts keeps {runId,startedAt} and two
 * tie-breaks to handle this. A commit identifies an exact point on one branch.
 *
 * Store a core fact. nyte.desktop.read-sessions.v1 lives in one window's
 * localStorage, so a TUI, phone or second desktop cannot see it. Reopening
 * elsewhere loses the place. snapshot.ts:231 already derives listing rows from
 * facts; unseen belongs in that row without a second source.
 */

/**
 * Seen-mark retention and view state
 *
 * A mark is not a ref. A ref's oid is a GC root at gc.ts:49 and would pin a branch
 * while its reader stays away. Refs cannot express start or never. Runners check
 * ref families at runner.ts:599; reader marks are not runner state. Accept a mark
 * on a swept abandoned path reading as start once rather than adding a reader pin.
 *
 * The view owns the divider and anchor as per-visit, per-window memory. A moving
 * core value would move the divider while the user reads. Pixel offsets belong
 * to one layout; the anchor keys a commit.
 */

/**
 * Boundary and migration rules
 *
 * - Operations must remove caller coordination before adding hooks/controllers.
 * - Domain types do not belong to wire-only modules. Conversation values must
 *   not expose HTTP envelopes, database rows or Electron handles.
 * - Core owns choice, routing and history. One actor journal owns pre-receipt
 *   records; session navigation cannot clear another actor's journal.
 * - After steer/queue migration, delete public messages.send delivery flags.
 *   Keep one canonical internal admission data operation.
 * - Keep driver, diagnostic and maintenance access purpose-specific rather
 *   than exposing session-pool, runner or cache classes. Diagnostics are local
 *   only; there is no remote raw-objects API.
 * - Derive clients, dispatch, codecs and capabilities from one operation catalog
 *   rather than adding another handwritten subset bridge.
 * - Keep modules by authority/domain. Avoid load/validate/prepare/run/finish
 *   folders that repeat the same object rules.
 */

// Failure contracts are declared in Part II.

/**
 * Lost replies and boundary failures
 *
 * Unknown write results retain their original identity. identity:null is valid
 * only before a write is attempted or its identity minted, never for ambiguity.
 * Directory find by generated session ID, Head.input(key), operations.find and
 * terminals.recover reconcile creation/admission identities after lost replies.
 * Same-key retry requires a stable identity; volatile actions require manual
 * recovery rather than automatic replay.
 * Internal causes stay host-side. Conflicts, busy and partial writes are explicit
 * method outcomes. Each operation declares its typed Result success and
 * failure variants in Part II; expected failures are not Promise rejections.
 * Validate JSON, branded IDs and direct IPC calls at the boundary. Capability
 * handles and types do not grant authority; authorization still runs.
 */

// Reference SDKs and proposed Nyte calls. Examples do not run at module load.
// CursorAgent and PiAgent name the two packages' Agent exports to avoid collision.
// Reference APIs keep their own returns/errors; only proposed Nyte uses Result.

// Code Storage SDK. @pierre/storage, c1bc584, src/index.ts:2107,2299,2328,2531.
// repo() binds synchronously. findOne() performs I/O and returns Repo | null.
async function referenceCodeStorageOpen(name: string, token: string, repoId: string) {
  const sdk = new CodeStorage({ name, token });
  const repo = sdk.repo({ id: repoId });
  const found = await sdk.findOne({ id: repoId });
  return { repo, found };
}

// Proposed Nyte. Connect first; binding a session does not check existence.
async function proposedCodeStorageBinding(options: ConnectOptions, id: SessionId) {
  const opened = await Nyte.connect(options);
  if (!opened.ok) return opened;
  await using connection = opened.value;
  const sdk = connection.sdk;
  const session = sdk.session(id);
  return await sdk.sessions.find(session.id); // Result<Lookup<SessionInfoView>, RequestFailure>.
}

// Code Storage SDK. src/commit.ts:149-226; README.md:467-525.
// commitMessage is Git metadata, not a chat prompt. Builder mutates; send is one-shot.
async function referenceCodeStorageCommit(
  sdk: InstanceType<typeof CodeStorage>,
  repoId: string,
  headSha: string,
  source: AsyncIterable<Uint8Array>,
) {
  const repo = sdk.repo({ id: repoId });
  return await repo
    .createCommit({
      targetBranch: "main",
      expectedHeadSha: headSha,
      commitMessage: "Update generated output",
      author: { name: "Build", email: "build@example.com" },
    })
    .addFile("generated/output.bin", source)
    .deletePath("generated/obsolete.bin")
    .send();
}

// Proposed Nyte. Upload produces replayable bytes; an immutable plan writes files.
// This is not a Git commit or a cross-file transaction. Check partial outcomes.
async function proposedCodeStorageFilePlan(
  files: FilesApi,
  changes: ChangesApi,
  key: CommandKey,
  source: AsyncIterable<Uint8Array>,
  output: ExpectedFile,
  obsolete: FileVersion,
) {
  const uploaded = await files.upload(source);
  if (!uploaded.ok) return uploaded;
  const submitted = await changes
    .batch({ key })
    .put({ path: "generated/output.bin", blob: uploaded.value, expect: output })
    .remove({ path: "generated/obsolete.bin", expect: obsolete })
    .apply();
  if (!submitted.ok) return submitted;
  return await submitted.value.settled();
}

// Proposed Nyte. Git commits are separate, guarded by the reviewed Git revision.
function proposedCodeStorageGitMessage(git: GitApi, reviewed: GitRevision) {
  return git.at(reviewed).commit({ message: "Update generated output", files: "staged" });
}

// Cursor SDK 1.0.36. dist/esm/options.d.ts:7-20,112-115; agent.d.ts:7-14,36-60;
// stubs.d.ts:45-58; run.d.ts:55-66. Local agents require a model.
async function referenceCursorMessage(cwd: string, modelId: string, key: string, imageUrl: string) {
  await using agent = await CursorAgent.create({ local: { cwd }, model: { id: modelId } });
  const run = await agent.send(
    { text: "Review this screen", images: [{ url: imageUrl }] },
    { idempotencyKey: key, model: { id: modelId } },
  );
  return await run.wait(); // Send returns a Run; wait returns its result.
}

// Proposed Nyte. Role/timestamp are core-owned. Images reference uploaded blobs.
// queue returns an input receipt, not a run. Model choice belongs to this input.
function proposedCursorMessage(
  sdk: Sdk,
  id: SessionId,
  key: SubmissionKey,
  history: HistoryEpoch,
  model: ModelRef,
  image: BlobId,
) {
  return sdk.session(id).queue(
    [
      { kind: "text", text: "Review this screen" },
      { kind: "image", blob: image, mime: "image/png" },
    ],
    { key, history, configuration: { kind: "patch", model } },
  );
}

// Cursor SDK. Run.steer? is optional; revert_to_followup leaves delivery to the caller.
// No public Cursor .queue() was found in this version.
type CursorReferenceRun = Awaited<
  ReturnType<Awaited<ReturnType<typeof CursorAgent.create>>["send"]>
>;
async function referenceCursorSteer(run: CursorReferenceRun, text: string) {
  if (run.steer === undefined) return { kind: "unsupported" } as const;
  return await run.steer(text); // complete_delivered | revert_to_followup.
}

// Proposed Nyte. Core owns fallback to the next turn under the same input key.
function proposedCursorSteer(sdk: Sdk, id: SessionId, text: string, key: SubmissionKey) {
  return sdk.session(id).steer(text, { key }); // Result<AdmittedInput, AdmissionFailure>.
}

// OpenCode v2. packages/sdk/src/promise.ts:20-68;
// packages/protocol/src/groups/session.ts:394-408; core/src/session/session.ts:145-177.
// resume:false demonstrates admission without waiting for or starting execution.
async function referenceOpenCodePrompt(directory: string, databasePath: string, text: string) {
  await using sdk = await OpenCode.create({ database: { path: databasePath } });
  const session = await sdk.sessions.create({ location: { directory } });
  return await sdk.sessions.prompt({
    sessionID: session.id,
    text,
    delivery: "queue", // Omission defaults to steer. This is a field, not .queue().
    resume: false,
  });
}

// Proposed Nyte. Explicit queue/steer verbs; opening a host does not acquire a runner.
async function proposedOpenCodePrompt(options: HostOpenOptions, text: string) {
  const opened = await Nyte.open(options);
  if (!opened.ok) return opened;
  await using host = opened.value;
  const created = await host.sdk.sessions.create();
  if (!created.ok) return created;
  return await created.value.queue(text, { key: host.sdk.keys.submission() });
}

// Pi agent-core. packages/agent/src/agent.ts:299-305,371-385.
// Its prompt accepts an explicit user-message envelope and waits for the loop.
async function referencePiMessage(options: ConstructorParameters<typeof PiAgent>[0]) {
  const agent = new PiAgent(options);
  await agent.prompt({
    role: "user",
    content: [{ type: "text", text: "Review the changes" }],
    timestamp: Date.now(),
  });
  return agent.state.messages;
}

// Proposed Nyte. Content and admission options, not a provider message envelope.
function proposedPiMessage(sdk: Sdk, id: SessionId, key: SubmissionKey) {
  return sdk.session(id).queue([{ kind: "text", text: "Review the changes" }], { key });
}

// Pi agent-core. These calls enqueue in memory on an existing running agent.
function referencePiDelivery(agent: InstanceType<typeof PiAgent>) {
  agent.steer({ role: "user", content: "Use pnpm, not npm", timestamp: Date.now() });
  agent.followUp({ role: "user", content: "Then run the tests", timestamp: Date.now() });
  // Both return void, not durable admission receipts.
}

// Proposed Nyte. Both calls durably admit an input; errors remain visible.
async function proposedPiDelivery(
  sdk: Sdk,
  id: SessionId,
  keys: readonly [SubmissionKey, SubmissionKey],
) {
  const session = sdk.session(id);
  const steered = await session.steer("Use pnpm, not npm", { key: keys[0] });
  if (!steered.ok) return steered;
  return await session.queue("Then run the tests", { key: keys[1] });
}

// Pi durable. packages/durable/src/harness/types.ts:55-84; README.md:49-76,108-125,310-318.
// requestId identifies the input; submit and wait are separate operations.
async function referencePiDurableMessage(
  options: Parameters<typeof Harness.open>[1],
  provider: string,
  modelId: string,
  requestId: string,
) {
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(new MemoryStorage(), options, context); // Memory-only demo.
  try {
    const root = await harness.root(context, { agent: { model: { provider, modelId } } });
    const submission = await root.submit(
      {
        type: "input",
        content: "Review the changes",
        requestId,
        whenBusy: "followUp", // Also steer | reject; omission means followUp.
      },
      context,
    );
    return await submission.wait(context);
  } finally {
    await harness.close(context);
  }
}

// Proposed Nyte. The host owns execution coverage. A receipt is not an answer.
async function proposedPiDurableMessage(
  sdk: Sdk,
  id: SessionId,
  key: SubmissionKey,
  signal: AbortSignal,
) {
  const session = sdk.session(id);
  const admitted = await session.queue("Review the changes", { key });
  if (!admitted.ok) return admitted;
  if (admitted.value.record.execution === "uncovered") return admitted;
  const landed = await admitted.value.landing({ signal });
  if (!landed.ok || landed.value.kind !== "landed") return landed;
  return await session.run(landed.value.runId).settled({ signal });
}

// Effect reference only. packages/effect/src/Effect.ts:116 at 8409eb4:
//   Effect<Success, Failure, Requirements>
// Proposed Nyte uses native parameters and Promise<Result>, not an Effect runtime.
function proposedDeclaredChannels(
  requirements: Pick<Sdk, "session">,
  request: {
    readonly session: SessionId;
    readonly content: UserContent;
    readonly key: SubmissionKey;
  },
): Promise<Result<AdmittedInput, AdmissionFailure>> {
  return requirements.session(request.session).queue(request.content, { key: request.key });
}

/**
 * Module ownership
 *
 * Keep existing package boundaries; no new @nyte-ai/sdk/@nyte-ai/harness
 * hierarchy is needed. Suggested filenames describe ownership, not files to
 * create now. Split an owner only when it becomes unreadable.
 */

/**
 * packages/schema
 *   Own portable domain records/schemas, brands and operation declarations.
 *   Separate encoded JSON from runtime resource values. Pure generated types
 *   derive here; no HTTP/IPC/Scope/SQL/native values leak into domain records.
 */

/**
 * packages/core
 *   Own admission, execution, history/navigation, jobs, environments and effects.
 *   Suggested owners: sdk/admission.ts, sdk/history.ts, sdk/resources.ts,
 *   sdk/operations.ts plus the existing kernel authorities. Keep business rules
 *   here rather than in apps behind a giant facade.
 *   Keep pure folding/projections browser-safe with no Node import. Restrict
 *   driver/maintenance access by authority and enforce dependency boundaries.
 *   Preserve existing kernel effects and PluginScope, not library services.
 */

/**
 * packages/client
 *   Own generated Promise/Result bindings, transport, connection identity,
 *   journal and observation recovery. Use core/view without Node execution.
 *   Remove core's dependency on client projections once these move to core/view.
 *   No Effect adapter or runtime dependency.
 */

/**
 * packages/protocol
 *   Keep envelopes, framing, error transport and derived catalog bindings.
 *   Delete RemoteSessions/RemoteRuns/... and duplicate domain schema/type lists.
 *   Do not delete a real transport boundary just to reduce a directory count.
 */

/**
 * packages/host
 *   Own local presets, model/auth services, trust, filesystem/Git/environment
 *   adapters and scoped MCP/source/exporter services. No durable conversation policy.
 */

/**
 * packages/server and serve
 *   Keep parsed request adapter separate from listener/static-site ownership.
 *   Remove per-method wake wrappers once admission persistently owns wake.
 *   Listeners dispatch the same catalog; local execution does not traverse fake HTTP.
 */

/**
 * packages/plugin
 *   Keep portable tool/plugin contracts at core/plugins. Move TUI-only Definition
 *   and UI slots to a TUI adapter export. No terminal renderer dependency in
 *   universal plugin authoring. Keep MCP/codemode/provider integrations separate.
 */

/**
 * packages/cloudflare and vercel
 *   Keep actual platform scheduling adapters. Share advancement/reconciliation
 *   semantics, not fictitious common platform lifetimes. Persist bounded repair.
 */

/**
 * packages/connect and connect-worker
 *   Keep account/machine/device/relay protocol outside conversation execution.
 *   Credentials, short leases, revocation and broker plaintext trust remain explicit.
 */

/**
 * Caller deletion map
 *
 * Replace callers and delete their old paths in the same migration.
 */

/**
 * core/kernel/sdk/nyte.ts
 *   Remove timing-selected public send delivery; replace separate configure/send
 *   coordination with captured input choices. Keep raw private admission kernel.
 */

/**
 * core/kernel/sdk/advance.ts and runner.ts
 *   Delete driver-specific incomplete reconciliation lists. One run reconciliation.
 */

/**
 * core/kernel/sdk/reads.ts and snapshot.ts
 *   Cache durable history-derived rows only; overlay current leases on reads.
 *   Coherent graph reader removes callers walking objects for normal /tree.
 */

/**
 * client/src/outbox.ts, session/session-follow.ts
 *   Replace public caller-assembled owners with connection-owned journal/recovery.
 *   Retain proven algorithms internally where they implement the new contract;
 *   don't delete correct retry/fold behavior merely because its filename changes.
 */

/**
 * tui/src/session-config.ts
 *   Delete configuration/send reservation state after choice capture is live.
 */

/**
 * tui/src/host.ts
 *   Delete sessionCommits store escape used only for normal /tree.
 */

/**
 * tui/src/interactive.ts
 *   Replace manual observer/outbox/config wiring and tree fetch/move choreography.
 *   Keep input preparation, slash UI, tree filters and terminal rendering.
 */

/**
 * app/src/use-outbox.ts and session-configuration.ts
 *   Delete behavioral coordination. Keep UI-selected values and query presentation.
 */

/**
 * app/src/live.ts, screens/thread.tsx
 *   Replace stopRunAndSettle/applyMessageEdit multi-call workflow with core edit.
 *   Delete plugin list invalidation once sdk.events catalog-changed lands; keep
 *   auxiliary jobs/VCS and frame scheduling only if still needed. Do not delete
 *   the whole files while those UI responsibilities remain.
 */

/**
 * app/src/session-read-state.ts
 *   Delete ReadCompletion {runId,startedAt}, its startedAt/runId tie-breaks, the
 *   localStorage key and useReadSessions. markRead callers (sidebar.tsx:532,536;
 *   search-palette.tsx:238; thread.tsx:381,383) become one markSeen in the thread
 *   view; sessionHasUnreadCompletion readers (sidebar-view.ts:81, status-glyph.tsx:25,
 *   use-window-tabs.tsx:181, subagent-call.tsx:164) read HeadInfoView.unseen.
 */

/**
 * app/src/layout/session-view-state.ts
 *   Replace ScrollViewState {top,bottomPinned} with ScrollAnchor keyed by commit,
 *   kept in window memory per head. Pixel offsets never leave the view.
 */

/**
 * app/src/bridge.ts, nyte.ts, web/bridge.ts; desktop/src/preload/index.ts
 *   Replace handwritten SDK subsets with one generated participant contract.
 *   Keep authenticated IPC, window authorization and native view endpoints.
 */

/**
 * desktop/src/main/browser*.ts, terminals.ts
 *   Move logical page/PTY contracts behind core drivers; retain Electron/CDP and
 *   OS implementation. A browser view, bounds and occlusion are never core state.
 */

/**
 * app/src/workbench/browser-surfaces.ts and controller.ts
 *   Delete URL-based adoption for agent pages; store exact PageId.
 */

/**
 * mobile/src/chat/session-observers.ts and remote-chat.ts
 *   Replace duplicated observer and retry identity coordination; retain app
 *   foreground/background subscription policy and Keychain connection persistence.
 */

/**
 * lab/server/review.ts
 *   Replace create-head -> configure -> send with branch + captured-choice queue.
 *   Generic remote head/tree APIs delete bespoke routes only where behavior matches.
 */

/**
 * demos/docs
 *   Replace old targeted call style and ownership examples together with clients.
 *   No silent aliases or compatibility wrappers freeze both APIs at first release.
 */

/**
 * Impact radius
 *   Durable semantics/storage: core, schema, store backends, platform scheduling.
 *   Portable methods/codecs: protocol, client, server, desktop IPC, all consumers.
 *   Concrete services/lifetimes: host, ai/provider resource pools, plugin integrations,
 *   desktop native drivers, CF/Vercel environment adapters.
 *   Product migration: app/web/desktop, TUI, mobile, lab, demos, SDK docs.
 *   Unchanged: UI component library, public site styling, native
 *   geometry algorithms, account trust model, four durable authorities.
 * Package counts do not estimate migration effort.
 */

/**
 * Admission verification
 *
 * - Same key + payload admits once; changed content/config/delivery returns key-conflict.
 * - Delayed local input cannot cross a history epoch. Original defaults survive
 *   retries; captured fast/request policy governs billing and compatible batching.
 * - Lost response, reconnect and actor restart retain identity.
 * - Admission and command receipts remain for the session lifetime, including
 *   after reconnect or graph lease expiry; no timer automatically expires them.
 * - App IndexedDB storage acknowledges persistence before draft handoff;
 *   TUI/embedded memory journals do not claim crash-safe handoff. Explicit
 *   persistent adapters preserve partition identity across actor restart.
 * - Unseen-key withdraw racing admission cannot resurrect withdrawn input.
 * - Exact choices cannot be structurally reinterpreted as patches; exact null
 *   and policy version survive edit/resubmit without resolving current defaults.
 * - Capture choice while config changes; compatible drain only; steer target
 *   ending before landing uses same input; pending input survives workspace switch.
 */

/**
 * History verification
 *
 * - Retained abandoned graph is complete at pinned seq while concurrent heads move.
 * - GC respects read pin and expiry; expired cursor never mixes snapshots.
 * - Host policy bounds graph leases and renewals. Renewal retains one snapshot;
 *   expiry releases its pin without expiring admission or command receipts.
 * - User-node navigation lands on parent; summary imports retain abandoned path.
 * - Edit publishes move+choice+input or none; exact-stop failure reports stoppedRun.
 * - Another run starting during stop cannot be stopped or overwritten accidentally.
 * - Summary failure records spend without moving head.
 */

/**
 * Seen verification
 *
 * - v1 keeps the single-reader fact shared by the owner's devices, not
 *   window-local marks or a new per-user read-state model.
 * - Two devices marking interleaved ancestors converge on the furthest; a late
 *   mark at an ancestor returns unchanged with no event; a CAS loser re-evaluates.
 * - After navigate to an ancestor or sibling, a mark on the abandoned path reads
 *   as the fork point; the next markSeen stores an ancestor of the new tip.
 * - Compaction appends a checkpoint; a mark behind it stays on the chain and
 *   unseen is the checkpoint or the first drawn commit after the mark.
 * - Streaming is never marked: a LivePartView has no CommitId; a mark at the tip
 *   during a live run leaves that run's later commits unseen.
 * - markSeen on an idle head starts no run and no advance; observers receive one
 *   fact event per effective change and none for a no-op.
 * - A commit from another session or a swept oid is missing-target, not a write.
 */

/**
 * Execution verification
 *
 * - Attached and single-step drivers reconcile jobs/delegation/input identically.
 * - Persist wake, then crash before dispatch; start workflow, then fail permanently.
 * - Bounded repair finds runnable head without surviving dispatch row.
 * - Reacquired leases fence old writers; safe replay checks environment identity.
 */

/**
 * Resources verification
 *
 * - Releasing view does not stop run/job/page's other holder.
 * - Owner PTY close terminates process; output attachment close does not.
 * - Lost PTY open response recovers by acquisition key; owner lease expires;
 *   recovery fences old owner and never respawns an uncertain prior process.
 * - Page adoption uses exact identity; stale document/name/access checks common
 *   to tools and direct SDK calls. Cookie profile != durable browser page.
 * - Host death grants no PTY or page survival guarantee. Recovery reports
 *   missing or uncertain native resources without claiming a preserved process.
 * - Partial setup unwinds every acquired owner, borrows remain open.
 * - Renderer consumes output before ACK; slow consumers stay bounded.
 * - File conflict/partial restore does not claim transaction or silently refresh
 *   expectation. File scan cap and external edits report incomplete.
 */

/**
 * Contracts verification
 *
 * - Same operations through direct core, IPC and HTTP yield equivalent domain
 *   outcomes after runtime decoding. Different concrete capabilities stay explicit.
 * - TS/Go/Python round-trip IDs, enums, omitted fields, meaningful null, errors,
 *   pagination, byte streams and cancellation without executing TS closures.
 * - Browser import graph excludes Node execution. Host and client add no
 *   Effect runtime, library, adapters, Layers or substitute mini runtime.
 * - Expected failures return typed Results through normal Promise execution;
 *   required dependencies are checked as actual TypeScript parameters.
 * - Existing kernel effects and PluginScope remain independent of that decision.
 * - Diagnostics stay local and authority-restricted; remote dispatch cannot read
 *   raw objects or decoded prompt/tool context through a diagnostic API.
 * - v1 exposes no cross-session conversation clone operation.
 * - sdk.catalog() and the generated TS client derive from the same declarations;
 *   a name missing from a host's catalog answers unavailable. A schema command
 *   called with a misspelled argument fails invalid-input before run, with the
 *   issue path naming the argument. checkPlugins on a plugin set with one bad
 *   declaration reports that declaration's file:line and still counts the rest;
 *   replacePlugins with an unparseable plugin returns kept-previous and the old
 *   version keeps serving. An observer receiving an unknown frame kind skips it
 *   and refetches rather than rendering a known variant.
 * - No old targeted method path remains in apps/demos/docs after migration.
 */

/**
 * Settled contracts
 *
 * - The host configures bounded, renewable graph leases. Explicit policy fields
 *   belong in Part II, not numerical defaults here. Admission and command
 *   receipts remain for the session lifetime, with no automatic receipt expiry.
 *   Workspace/host commands retain receipts under their corresponding durable owner.
 * - App connections use a persistent IndexedDB journal. TUI and embedded
 *   connections use memory unless persistence is explicitly configured. Journal
 *   durability describes pre-receipt handoff, not native resource survival.
 * - Native PTYs and browser pages have no host-death survival guarantee. Durable
 *   acquisition identity does not make an OS process or Electron page durable.
 * - v1 has no cross-session conversation clone. Branching and delegation remain;
 *   neither silently copies session state into another session.
 * - v1 uses the specified single-reader, owner-shared seen fact. The owner's
 *   devices share progress; each view keeps its own divider and scroll anchor.
 * - Diagnostics are local only and require documented host authority. There is
 *   no remote raw-objects API, including decoded prompt or tool context. Preserve
 *   local driver/maintenance access without granting it to connected clients.
 * - The Effect source is a reference for explicit success, requirements and
 *   error contracts only, not library adoption. Use typed Results, actual
 *   TypeScript parameters and normal Promises; keep kernel effects and PluginScope.
 */

/**
 * Next implementation step
 *
 * Implement the schema/handler contract for keyed choice-capturing admission and
 * coherent retained-history reads in core, exercise it through direct and remote
 * drivers, migrate TUI/desktop to it, and delete their old coordination together.
 * Add framework hooks only after that migration.
 */

/**
 * Review record
 * Source/design review covered ownership, types, recovery and architecture.
 * Concurrent read-anchor/seen-mark additions were outside the final targeted audit.
 * Bun's TypeScript parser accepted the file; it has no imports. These checks did
 * not compile schematic fixture names or run demos, package tests/builds or transports.
 */
