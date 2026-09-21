import { create, props } from "@stylexjs/stylex";
import { color } from "./tokens/color.stylex";

const styles = create({
  page: {
    maxWidth: "94ch",
    marginInline: "auto",
    padding: "1em",
    color: color.textPrimary,
    backgroundColor: color.surfacePage,
    lineHeight: 1.6,
    overflowWrap: "anywhere",
  },
  heading: { fontSize: "1em" },
  trace: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  table: { display: "block", overflowX: "auto", textAlign: "start" },
  cell: { padding: "0.5em", verticalAlign: "top" },
  question: { paddingBlock: "0.5em", minHeight: "2.75em", cursor: "pointer" },
});

export function CoreReview() {
  return (
    <main {...props(styles.page)}>
      <header>
        <h1 {...props(styles.heading)}>Core architecture</h1>
        <p>
          Core decides which input lands, which run may execute, what survives a restart, and what
          each client observes. Desktop, TUI, mobile, and cloud hosts use those decisions without
          sharing a renderer or a process. This review follows the functions between them and
          examines where their contracts fail to connect.
        </p>
        <p>
          Source baseline <code>c02321f624bc66e632195a0467e6831206c015a0</code> on <code>main</code>
          . Links point to that revision. Concurrent working-tree changes are outside the baseline.
          Proposed fixes below are not implemented.
        </p>
      </header>
      <nav aria-label="Page contents">
        <h2 {...props(styles.heading)}>Contents</h2>
        <ol>
          <li>
            <a href="#reading">Terms and evidence</a>
          </li>
          <li>
            <a href="#boundary">The core boundary</a>
          </li>
          <li>
            <a href="#send">One message through the kernel</a>
          </li>
          <li>
            <a href="#turn">Provider and tool runtime</a>
          </li>
          <li>
            <a href="#clients">Snapshots, events, and clients</a>
          </li>
          <li>
            <a href="#history">History navigation and editing</a>
          </li>
          <li>
            <a href="#plugins">Plugins, skills, MCP, and reload</a>
          </li>
          <li>
            <a href="#pi">What to borrow from Pi</a>
          </li>
          <li>
            <a href="#proof">Verification harness</a>
          </li>
          <li>
            <a href="#corrections">Obsolete claims corrected</a>
          </li>
          <li>
            <a href="#fixes">Prioritized fixes</a>
          </li>
          <li>
            <a href="#quiz">Knowledge check</a>
          </li>
        </ol>
      </nav>
      <section id="reading">
        <h2 {...props(styles.heading)}>Terms and evidence</h2>
        <p>
          A session is a persistent conversation. A head selects a branch of its history. A run is
          one execution on that head and may include several model responses and tool calls. A
          transcript turn groups displayed parts; it is not an execution lifetime. Agent presets
          configure sessions. Subagents are child sessions used for delegated work.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/types.ts#L68-L96">
            core/plugins/types.ts:68-96
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/protocol/src/views.ts#L50-L69">
            protocol/views.ts:50-69
          </a>
        </p>
        <p>
          This review uses four labels. <strong>Fact</strong> means the pinned source or the
          acceptance results below directly support the statement. <strong>Inferred risk</strong>{" "}
          means the code permits a failure, but this review did not reproduce it.{" "}
          <strong>Recommendation</strong> names a proposed contract or change. It is not
          implemented. <strong>Unknown</strong> marks behavior that the source and reviewed tests do
          not settle.
        </p>
        <p>
          This page replaces the old handoff and export trace. The correction table distinguishes
          outdated findings from problems that remain in the source.
        </p>
      </section>
      <section id="boundary">
        <h2 {...props(styles.heading)}>The core boundary</h2>
        <p>
          <strong>Fact.</strong> <code>createNyte</code> is the composition root for the SDK. It
          constructs a session pool, runners, delegation, relocation, summary reads, and ordinary
          reads. The returned <code>Nyte</code> object exposes session, message, run, head,
          workspace, plugin, and watch operations.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/nyte.ts#L127-L181">
            core/sdk/nyte.ts:127-181
          </a>
        </p>
        <h3 {...props(styles.heading)}>Package topology</h3>
        <pre
          aria-label="Package responsibility map"
          {...props(styles.trace)}
        >{`@nyte-ai/protocol   wire operations, TypeBox schemas, transport-neutral events
@nyte-ai/client     HTTP/SSE client, snapshot/event fold, transcript and tree views
@nyte-ai/core       durable kernel, SDK, turns, effects, plugin activation
@nyte-ai/host       Node workspace, models, files, Git, plugin source composition
@nyte-ai/server     authenticated HTTP/SSE adapter over an existing SDK

@nyte-ai/ai         provider catalog and provider stream implementations
apps                desktop, TUI, mobile, and demo cloud hosts choose adapters`}</pre>
        <p>
          Server depends on the SDK contract, not on <code>@nyte-ai/host</code>. Core also directly
          imports shared protocol and schema types and client-owned pure projections.{" "}
          <code>protocol</code> and <code>client</code> stay Node-free. Core owns durable decisions
          but receives host services. Host supplies operating-system and workspace behavior. Server
          exposes an already composed SDK; it does not become the host. AI adapts model providers
          without deciding kernel admission. Apps choose which pieces to compose and which UX
          capabilities to expose.
        </p>
        <h3 {...props(styles.heading)}>Four store authorities</h3>
        <table {...props(styles.table)}>
          <thead>
            <tr>
              <th {...props(styles.cell)}>Authority</th>
              <th {...props(styles.cell)}>What it owns</th>
              <th {...props(styles.cell)}>What it does not mean</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td {...props(styles.cell)}>
                <code>objects</code>
              </td>
              <td {...props(styles.cell)}>
                Immutable content-addressed commits, changes, runs, effects, stacks, and blobs.
              </td>
              <td {...props(styles.cell)}>Writing an object does not publish it.</td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>refs</code>
              </td>
              <td {...props(styles.cell)}>
                Mutable names selecting published objects. Multi-ref compare-and-swap changes those
                names together.
              </td>
              <td {...props(styles.cell)}>A losing CAS changes none of its refs.</td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>leases</code>
              </td>
              <td {...props(styles.cell)}>
                Time-bounded execution rights with an increasing fence on takeover.
              </td>
              <td {...props(styles.cell)}>
                A lease is not conversation history and cannot undo external work.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>events</code>
              </td>
              <td {...props(styles.cell)}>
                One ordered per-session reflog and live feed, plus fenced deltas, progress, and
                notices.
              </td>
              <td {...props(styles.cell)}>It is not a second mutable transcript.</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Store contract.</strong> <code>refs.update</code> checks every expected{" "}
          <code>from</code>, validates an optional lease, writes every <code>to</code>, appends ref
          events plus supplied events, and commits those writes in one transaction. SQLite notifies
          watchers after the transaction commits. The store guarantees atomicity for the supplied
          update list; each kernel operation must include all the refs its transition requires.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/store.ts#L1-L91">
            core/store.ts:1-91
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sqlite.ts#L646-L654">
            core/sqlite.ts:646-654
          </a>
        </p>
        <pre aria-label="Core composition call tree" {...props(styles.trace)}>{`createNyte(options)
  createSessionPool
    owns open sessions, activation lookup, facts, current runs
  createRunners
    reconciles durable state with local execution
  createDelegation
    owns child-session requests, authorization, and jobs
  createRelocation
    moves session execution between workspace locations
  createSummaries
  createReads
  return Nyte operations`}</pre>
        <p>
          The kernel owns durable sequencing. Clients can request work, but they do not decide
          whether queued input joins a live run, starts a new run, waits, settles a prior run, or
          forces a handoff. The provider loop also does not make that decision. It receives one
          resolved turn at a time.
        </p>
        <h3 {...props(styles.heading)}>Why keep these boundaries</h3>
        <p>
          Immutable objects preserve earlier state for history reads and recovery. CAS rejects a
          conflicting publication instead of overwriting another client's work. The cost is loose
          objects, reference bookkeeping, replay, and garbage collection. Core owns these rules so
          every client gets the same conflict and recovery behavior.
        </p>
        <p>
          Core imports client-owned pure projections so snapshot and incremental rendering share
          vocabulary. That is defensible only while those imports remain runtime-neutral functions,
          with no React, transport lifecycle, or app state. Desktop, TUI, and mobile may differ in
          layout and input, but durable command outcomes must not change with the renderer.
        </p>
        <p>
          SQLite can run behind <code>WorkerStore</code> so storage work does not block the host's
          foreground thread. Its bridge carries request ids and session handles into{" "}
          <code>store-worker</code>; replies resolve the matching promise, and watch credits limit
          event batches. The 24-method RPC is a storage transport, not a second scheduler. TUI still
          names its worker with source and Bun-layout strings while desktop imports the package
          entry. A packaged-binary test should guard that seam.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/store-rpc.ts#L1-L80">
            core/store-rpc.ts:1-80
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/tui/src/host.ts#L157-L166">
            tui/host.ts:157-166
          </a>
        </p>
        <h3 {...props(styles.heading)}>Five public entries</h3>
        <table {...props(styles.table)}>
          <thead>
            <tr>
              <th {...props(styles.cell)}>Entry</th>
              <th {...props(styles.cell)}>Responsibility</th>
              <th {...props(styles.cell)}>Boundary note</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td {...props(styles.cell)}>
                <code>@nyte-ai/core</code>
              </td>
              <td {...props(styles.cell)}>
                SDK construction, dispatch, plugin source resolution, and primary kernel types.
              </td>
              <td {...props(styles.cell)}>
                The host composes it; server and desktop transports dispatch operations through it.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>@nyte-ai/core/plugins</code>
              </td>
              <td {...props(styles.cell)}>
                Plugin definitions, tool binding, hooks, built-in context and skills support.
              </td>
              <td {...props(styles.cell)}>
                <code>@nyte-ai/plugin</code> republishes this plugin-facing API.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>@nyte-ai/core/store</code>
              </td>
              <td {...props(styles.cell)}>
                Store interfaces and concrete local or worker-backed stores.
              </td>
              <td {...props(styles.cell)}>
                This is persistence infrastructure, not the client read model.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>@nyte-ai/core/postgres</code>
              </td>
              <td {...props(styles.cell)}>Postgres store construction.</td>
              <td {...props(styles.cell)}>
                Separate because it brings a deployment-specific backend.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>@nyte-ai/core/store-worker</code>
              </td>
              <td {...props(styles.cell)}>Worker side-effect entry for store RPC.</td>
              <td {...props(styles.cell)}>
                It exports no ordinary API. Loading the module starts the worker handler.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Core still re-exports many protocol names. <code>SessionInfo</code> names a client read
          model in protocol and a storage row under <code>./store</code>. <code>toJsonValue</code>{" "}
          has three import routes. These exports obscure which package owns each contract.
        </p>
      </section>
      <section id="send">
        <h2 {...props(styles.heading)}>One message through the kernel</h2>
        <p>
          A send has two distinct moments. Submission makes an immutable change reachable from an
          inbox ref. Landing later turns that change into one or more commits and advances the
          conversation head. Keeping those moments separate lets concurrent clients submit without
          giving each client authority over run scheduling.
        </p>
        <pre
          aria-label="Message send call tree"
          {...props(styles.trace)}
        >{`nyte.messages.send                         core/sdk/nyte.ts:333
  submit                                    core/queue.ts:180
    write immutable Change object
    CAS inbox tip and optional idempotency-key ref
  runners.reconcileRunner
    createRunner or wake existing runner    core/sdk/runner.ts:322,344
      drive                                 core/step.ts:987
        step                                core/step.ts:935
          runStep                           core/step.ts:858
            advance                         core/step.ts:893
              dispatch by durable Run.phase
              land                          core/step.ts:239
                leadFor + decide             core/admission.ts:175,50
                commitsFor                   core/step.ts:157
                publish one CAS              core/step.ts:339-352`}</pre>
        <h3 {...props(styles.heading)}>Submission is immutable and retryable</h3>
        <p>
          <strong>Fact.</strong> <code>messages.send</code> normalizes content, creates a user{" "}
          <code>Change</code>, attaches actor and delegation metadata, and calls <code>submit</code>
          . <code>submit</code> stores the change object before it compares and swaps the inbox tip.
          When a caller supplies a key, the same CAS also claims <code>refs/keys/&lt;key&gt;</code>.
          A retry reads that ref and returns the existing change instead of appending a duplicate.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/nyte.ts#L333-L372">
            core/sdk/nyte.ts:333-372
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/queue.ts#L180-L248">
            core/queue.ts:180-248
          </a>
        </p>
        <p>
          The object write may leave an unreachable object after a losing CAS. That is acceptable in
          a content-addressed store; reachability, not object creation alone, publishes state. The
          idempotency ref and inbox tip change together.
        </p>
        <h3 {...props(styles.heading)}>Admission is one kernel decision</h3>
        <p>
          Each head has two inbox delivery chains, <code>steer</code> and <code>next</code>.
          Delivery says when the input should be considered; the change kind says whether it is user
          input, a delegated answer, a passive update, or a report. Neither is a second conversation
          branch. Admission combines those facts with the current run instead of leaving each client
          to invent queue policy.
        </p>
        <p>
          <strong>Fact.</strong> <code>headFor</code> reduces the current run to <code>fresh</code>,{" "}
          <code>idle</code>, <code>live</code>, or <code>settling</code>. <code>leadFor</code>{" "}
          reduces the first relevant change to <code>user</code>, <code>passive</code>,{" "}
          <code>report</code>, or an authorized or unauthorized <code>answer</code>.{" "}
          <code>decide</code> maps those values, plus an agent change, to <code>wait</code>,{" "}
          <code>join</code>, <code>handoff</code>, <code>settle</code>, or <code>start</code>.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/admission.ts#L9-L158">
            core/admission.ts:9-158
          </a>
        </p>
        <p>
          <code>landsNow</code> reuses the same admission functions when waiting and relocation need
          to ask whether queued input can land now.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/admission.ts#L221-L237">
            core/admission.ts:221-237
          </a>
        </p>
        <h3 {...props(styles.heading)}>Landing publishes one state transition</h3>
        <p>
          <strong>Fact.</strong> <code>land</code> reads a delivery chain, picks a batch, asks{" "}
          <code>decide</code>, then prepares the objects and ref updates required by that decision.
          For a landing, <code>publish</code> advances the head and inbox base together, with run
          changes and continuation authorization consumption where required. Cancellation checks
          join the same CAS. A conflict publishes none of those ref changes.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/step.ts#L239-L353">
            core/step.ts:239-353
          </a>
        </p>
        <p>
          A lease fence also prevents an old runner from publishing refs, events, or effects after a
          successor takes ownership.
        </p>
      </section>
      <section id="turn">
        <h2 {...props(styles.heading)}>Provider and tool runtime</h2>
        <p>
          This is the runtime agent harness. It binds provider requests, context, policies, tools,
          and cancellation to core's durable run machine. Here <code>bindTurn</code> supplies
          response and tool handlers; it does not create the transcript's <code>Turn</code> read
          model. The verification harness is test infrastructure.
        </p>
        <p>
          <code>turnFor</code> resolves the run's model, agent, system prompt, tool registry, hooks,
          thinking level, retry policy, and compaction settings. <code>requestStream</code> applies{" "}
          <code>before_request</code> patches, preserves request purpose, records telemetry, calls
          the provider stream, and normalizes thrown provider failures.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/activation.ts#L511-L665">
            core/sdk/activation.ts:511-665
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/requests.ts#L86-L153">
            core/sdk/requests.ts:86-153
          </a>
        </p>
        <pre aria-label="Turn execution call tree" {...props(styles.trace)}>{`step.advance
  respond
    reserve one root response attempt by CAS
    callTurn
      renew lease while provider work runs
      turn.respond
        resolve model, agent, prompt, tools, hooks
        bindTurn.respond
          generateAssistant streams one assistant response
    publish assistant commit + next run phase by CAS
    if that phase is tools, the next step enters tools

  tools
    callTurn
      turn.tools
        bindTurn.tools / runTools
          executeToolCalls prepares calls in source order
          durableTools opens intent before each tool
          tool implementations may run concurrently
          results are returned in source order
    publish tool-result commits + clear effects by CAS`}</pre>
        <p>
          <code>generateAssistant</code> transforms context and streams one assistant message. Tool
          execution happens later: <code>executeToolCalls</code> prepares calls in source order,
          permits concurrent execution, and returns ordered results through{" "}
          <code>durableTools</code>.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/loop/agent-loop.ts#L30-L157">
            core/loop/agent-loop.ts:30-157
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/turn.ts#L646-L790">
            core/turn.ts:646-790
          </a>
        </p>
        <p>
          <strong>Fact.</strong> Before asking the model for another assistant response,{" "}
          <code>respond</code> increments the root chain counter with a CAS. That counter enforces
          the response budget across continuations. The final assistant commit and next run phase
          then publish together. Stream deltas carry <code>runId</code>, attempt, and index. They
          are recorded events but remain provisional response text until an assistant commit lands.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/step.ts#L597-L688">
            core/step.ts:597-688
          </a>
        </p>
        <h3 {...props(styles.heading)}>Durable effects</h3>
        <p>
          <strong>Fact.</strong> A tool call is not represented only by an in-memory promise.{" "}
          <code>openEffect</code> first publishes an intent containing the run, call, tool name,
          JSON arguments, and replay policy. The state can then become waiting, expired, signalled,
          or settled with a result. When a caller supplies <code>waitId</code>,{" "}
          <code>signalEffect</code> rejects a different waiting generation. Competing signals for
          the same wait have one CAS winner. Recovery executes a <code>safe</code> unresolved
          intent, marks a <code>never</code> intent interrupted, keeps waits blocked, wakes
          signalled or expired calls, and reuses settled results.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/model.ts#L102-L145">
            core/model.ts:102-145
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/effects.ts#L140-L181">
            core/effects.ts:140-181
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/effects.ts#L238-L369">
            core/effects.ts:238-369
          </a>
        </p>
        <p>
          <code>before_tool</code> hooks run before the durable tool handler and can continue,
          replace arguments, reject one call, or fail policy for the run. <code>after_tool</code>{" "}
          handles the outcome. A <code>safe</code> replay may execute again after a crash; it is not
          exactly-once delivery to an external service. Such a service needs its own idempotency
          contract. When a batch finishes, <code>publishTools</code> advances the head and run while
          clearing the effect refs under the same lease and CAS expectations. This prevents a
          published tool-result commit from leaving its effect looking live.
        </p>
        <h3 {...props(styles.heading)}>Checkpoints, jobs, and child sessions</h3>
        <p>
          A core checkpoint records compacted model context. <code>turn.respond</code> may compact
          before the next provider request at its context threshold, or after a context-overflow
          response has ended. <code>publishCheckpoint</code> publishes that checkpoint under the
          head lease. Editing instead moves to a selected user message's parent and resubmits the
          message. The edit point, compaction checkpoint, and workspace restore point are distinct.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/turn.ts#L239-L295">
            core/turn.ts:239-295
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/step.ts#L539-L577">
            core/step.ts:539-577
          </a>
        </p>
        <p>
          A background command is a job. A subagent is a persistent child session addressed through{" "}
          <code>create</code>, <code>send</code>, <code>await</code>, <code>read</code>, and{" "}
          <code>stop</code>. Cancelling a wait only ends the wait. Aborting the parent run
          interrupts its owned commands and revokes unused continuation authority, but does not
          automatically stop every child it created.
        </p>
        <p>
          A child's answer may continue a parent request only through a matching authorization.{" "}
          <code>authorizedContinuation</code> supplies the ref update that consumes that
          authorization, and <code>land</code> publishes consumption with the continuation. Two
          hosts cannot both spend it. <code>revokeDelegations</code> withdraws unused authority
          after abort or failure; a late answer is not permission to restart work.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/delegation-record.ts#L109-L164">
            core/delegation-record.ts:109-164
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/nyte.ts#L441-L455">
            core/sdk/nyte.ts:441-455
          </a>
        </p>
        <h3 {...props(styles.heading)}>Stop means request, not rollback</h3>
        <p>
          <strong>Fact.</strong> <code>runs.abort</code> marks the durable run{" "}
          <code>abortRequested</code> and revokes delegation authorization. Local runners also abort
          their signal, while <code>advanceStep</code> watches the durable run ref so a remote abort
          reaches the active host. <code>endingPhase</code> forces any terminal publication after
          the flag to become <code>aborted</code>. The operation has requested a stop; it has not
          proved that the run is terminal yet.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/nyte.ts#L441-L458">
            core/sdk/nyte.ts:441-458
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/advance.ts#L10-L51">
            core/sdk/advance.ts:10-51
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/step.ts#L136-L153">
            core/step.ts:136-153
          </a>
        </p>
        <p>
          <strong>Inferred risk.</strong> <code>withLeaseRenewal</code> awaits the wrapped promise
          and renews the lease until that promise settles. A tool that ignores its abort signal can
          leave the UI in a stopping state while its external work continues. Fencing prevents stale
          durable publication. It cannot cancel an HTTP request, shell process, MCP mutation, or
          other effect that ignores cancellation.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/lease.ts#L12-L51">
            core/lease.ts:12-51
          </a>
        </p>
      </section>
      <section id="clients">
        <h2 {...props(styles.heading)}>Snapshots, events, and clients</h2>
        <p>
          Nyte has durable kernel events and public session events. They are not two stored
          transcript models. <code>projectEvent</code> converts raw ref, delta, progress, and notice
          records into public events such as <code>head_moved</code>, reachable commits, text
          deltas, tool progress, and diagnostics. One raw ref event can expand into several public
          events, and siblings may share a sequence number.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/events.ts#L304-L361">
            core/sdk/events.ts:304-361
          </a>
        </p>
        <pre
          aria-label="Client follow call tree"
          {...props(styles.trace)}
        >{`SessionObserver.start                    client/session-follow.ts:102
  sessions.snapshot
    stateFromSnapshot                    client/session-state.ts:90
      wrap snapshot.transcript as { items, tip }
      do not traverse commit history again
  nyte.watch(afterSeq)
    watchSession                         core/sdk/watch.ts:53
      raw session.events.watch
      projectEvent for each raw event
      emit synced only after equal-seq siblings
  foldEvent
    update transcript, overlay, run, pending, metadata
  on cursor expiry or fold request
    discard local state and snapshot again`}</pre>
        <p>
          <strong>Fact.</strong> <code>stateFromSnapshot</code> wraps{" "}
          <code>snapshot.transcript</code> and copies the rest of the snapshot into client state. It
          does not unfold commit history and project a second transcript. The live observer then
          folds public events, refreshes metadata behind the fold, and resnapshots after cursor
          expiry or an explicit fold outcome.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/client/src/session/session-state.ts#L90-L116">
            client/session-state.ts:90-116
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/client/src/session/session-follow.ts#L102-L286">
            client/session-follow.ts:102-286
          </a>
        </p>
        <h3 {...props(styles.heading)}>The actual repeated projection</h3>
        <p>
          <strong>Fact.</strong> Every public watcher creates its own raw durable watch and calls{" "}
          <code>projectEvent</code>. If a plugin first subscribes to session events, activation
          starts one additional raw watch and projects that stream once for all plugin listeners.
          For one session activation with plugin listeners, <em>N</em> public watchers produce{" "}
          <em>N + 1</em> live projection paths. Across SDK instances or hosts, each activation adds
          its own plugin watch: the count is <em>N + A</em>, where <em>A</em> is the number of
          activations with plugin listeners. Head, inbox, effect, and other ref projections may
          repeat graph and object reads for each subscriber. The runner and abort watcher also
          consume raw events, but they inspect refs directly and do not project client events.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/watch.ts#L103-L105">
            core/sdk/watch.ts:103-105
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/watch.ts#L178-L182">
            core/sdk/watch.ts:178-182
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/activation.ts#L236-L274">
            core/sdk/activation.ts:236-274
          </a>
        </p>
        <p>
          <strong>Recommendation.</strong> Measure object reads and projection time with multiple
          desktop, TUI, mobile, cloud, and plugin subscribers. If the cost is material, pool only
          the live projected tail and fan it out. Keep independent historical replay, slow-consumer
          isolation, cursor expiry, and resnapshot behavior per subscriber. A shared tail is not
          permission to replace the durable journal with a process-local event bus.
        </p>
        <p>
          <strong>Unknown.</strong> Deltas can persist before a final publication loses its CAS. The
          concurrency harness proves the durable publication conflict, but this review has not
          proved that every UI fold clears the exact losing attempt's overlay in every timing. That
          needs a client-level race test.
        </p>
        <h3 {...props(styles.heading)}>Desktop reaches the kernel by two routes</h3>
        <p>
          A desktop send begins in <code>Composer.send</code>. The persisted renderer outbox assigns
          an idempotency key before the first attempt, then the preload bridge calls{" "}
          <code>DesktopHost.callSdk</code>. The host resolves which workspace owns the session and
          attaches a runner. A local target reaches a <code>createHost</code> instance backed by{" "}
          <code>WorkerStore</code>, a provider model catalog, version control, and plugins. A server
          target instead reaches <code>createNyteClient</code>, which posts a schema-checked{" "}
          <code>messages.send</code> call to <code>@nyte-ai/server</code>. The server validates the
          request, applies its permission callback when configured, and dispatches to the same core
          method.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/conversation/composer.tsx#L872-L976">
            desktop/composer.tsx:872-976
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/outbox.ts#L184-L216">
            desktop/outbox.ts:184-216
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/main/host.ts#L505-L615">
            desktop/main/host.ts:505-615
          </a>
        </p>
        <pre aria-label="Desktop send and display path" {...props(styles.trace)}>{`Composer.send
  persisted outbox, key minted before attempt
  preload bridge
  DesktopHost.callSdk
    local: createHost -> core messages.send
    remote: createNyteClient -> HTTP call -> server dispatch -> core messages.send

core watch -> projectEvent
  local: main-process IPC event
  remote: pull-driven SSE frame
  renderer watchEvents queue
  SessionObserver -> foldEvent
  LiveStore separates durable snapshot from live overlay
  SessionConversation combines transcript + outbox + overlay
  LiveTurn renders streaming Markdown and tool rows`}</pre>
        <p>
          Desktop caches durable state separately from the live overlay, combines it with persisted
          outbox rows, and renders streaming text through <code>LiveTurn</code>. Desktop main owns
          target routing, store lifecycle, workspace trust, models, plugins, runners, local server
          sharing, and the IPC bridge.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/live.ts#L91-L104">
            desktop/live.ts:91-104
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/screens/thread.tsx#L646-L771">
            desktop/thread.tsx:646-771
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/conversation/live-turn.tsx#L47-L87">
            desktop/live-turn.tsx:47-87
          </a>
        </p>
        <p>
          <strong>Inferred risk.</strong> The renderer's IPC adapter appends to an unbounded array
          when the consumer is slower than main. Core's provider outbox is bounded and server SSE
          pulls one frame at a time, but the desktop bridge has no credit protocol. A bounded IPC
          stream should resnapshot on overflow rather than silently drop events and continue as
          though the stream were complete.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/nyte.ts#L31-L66">
            desktop/nyte.ts:31-66
          </a>
        </p>
        <h3 {...props(styles.heading)}>TUI input and rendering</h3>
        <p>
          TUI opens a local host, attaches the selected session, creates an in-memory retrying
          outbox, and follows it with <code>SessionObserver</code>. Observer updates schedule{" "}
          <code>TranscriptView.sync</code>, which reconciles durable rows and the live overlay into
          terminal output. The retry key survives retries while that TUI process and outbox entry
          remain alive, but the outbox is not persisted.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/tui/src/interactive.ts#L817-L964">
            tui/interactive.ts:817-964
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/tui/src/outbox.ts#L78-L155">
            tui/outbox.ts:78-155
          </a>
        </p>
        <p>
          TUI stop captures and sends the observed <code>runId</code>. After an aborted run, it can
          move the head with the observed tip as <code>expect</code> and restore the unanswered user
          text to the composer. It does not automatically resend. TUI owns that sequence; core does
          not offer a combined edit-and-resend operation.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/tui/src/interactive.ts#L2577-L2604">
            tui/interactive.ts:2577-2604
          </a>
        </p>
        <h3 {...props(styles.heading)}>Mobile is a remote client</h3>
        <p>
          The iOS app creates <code>createNyteClient</code> over HTTP and SSE. Its composer keeps
          one retry key while the conversation remains mounted. On background it closes the
          observer; foreground creates a fresh observer and snapshot. <code>MessageRow</code>{" "}
          renders queued, settled, streaming, work, summary, checkpoint, and config rows. Mobile has
          no committed-message edit flow and no durable offline outbox.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/mobile/src/connection/host.ts#L14-L16">
            mobile/connection/host.ts:14-16
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/mobile/src/chat/remote-chat.ts#L58-L185">
            mobile/remote-chat.ts:58-185
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/mobile/src/chat/messages.tsx#L378-L425">
            mobile/messages.tsx:378-425
          </a>
        </p>
        <p>
          Desktop, TUI, and mobile share snapshot, watch, and fold code. They do not have equal
          product capabilities. Mobile is remote-only, TUI's outbox is memory-only, and desktop adds
          persistence, branch editing, workspace trust, and local host ownership.
        </p>
        <h3 {...props(styles.heading)}>Server and cloud execution</h3>
        <p>
          <code>@nyte-ai/server</code> adapts authenticated HTTP calls and SSE watches to an SDK. It
          does not create a store, attach runners, or own host lifecycle. The Vercel demo opens
          Postgres and directly creates a Nyte SDK. Its wrapper wakes workflows after queued
          configuration, sends, redelivery, replies, and requested aborts. Workflow steps call{" "}
          <code>sdk.advance</code>. The full visible path is:
        </p>
        <pre
          aria-label="Demo cloud result path"
          {...props(styles.trace)}
        >{`workflow step -> sdk.advance
  core publishes refs and durable Postgres events
  server watch projects events and emits pull-driven SSE
  createNyteClient validates and yields SessionEvent frames
  SessionObserver folds snapshot + events
  mobile MessageRow or remote desktop LiveTurn renders the result`}</pre>
        <p>
          The demo provides deployment code for one user's host. This review did not verify a live
          deployment.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/demo/server/vercel/src/chat.ts#L48-L118">
            demo/vercel/chat.ts:48-118
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/demo/server/vercel/src/advance.ts#L1-L12">
            demo/vercel/advance.ts:1-12
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/demo/server/vercel/README.md#L79-L87">
            demo/vercel/README.md:79-87
          </a>
        </p>
        <p>
          <strong>Security boundary.</strong> The server can compare a fixed bearer token in
          constant time or call a custom authorize function. Per-operation permission callbacks run
          before dispatch, and watch permission is checked when the watch opens. The resulting
          decision is allow or deny; no principal is passed into the SDK, list results are not
          automatically filtered by identity, and an open watch has no built-in live authorization
          revocation.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/server/src/index.ts#L359-L414">
            server/index.ts:359-414
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/server/src/index.ts#L472-L508">
            server/index.ts:472-508
          </a>
        </p>
        <p>
          The Postgres store addresses sessions by globally named <code>id</code> and{" "}
          <code>list()</code> returns every row visible to that store. Row locks provide concurrency
          control, not authorization. The Vercel demo's single bearer token and shared store are not
          a secure multi-user tenant design. Tenant isolation belongs in principal-aware host and
          server routing plus store partitioning, not in account UI and not necessarily in the
          guarded kernel. Tenant-keyed tables are one option. A principal-bound isolated store or
          schema with scoped routing is another.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/postgres/store.ts#L61-L102">
            core/postgres/store.ts:61-102
          </a>
        </p>
        <p>
          Desktop's mobile share is intentionally different. Each start creates a random 256-bit
          bearer token and exposes the selected local SDK. The token holder receives that exposed
          SDK, including workspace selection; there is no per-operation identity filter. Local
          workspace trust controls automatic activation and guarded host operations. It is not
          remote tenancy.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/main/mobile-share.ts#L40-L110">
            desktop/mobile-share.ts:40-110
          </a>
        </p>
        <p>
          <strong>Inferred risk.</strong> Each Postgres watch polls independently. This review did
          not measure its cost. Core exposes <code>trimStream</code>, but no production caller was
          found in the audited host paths.
        </p>
      </section>
      <section id="history">
        <h2 {...props(styles.heading)}>History navigation and editing</h2>
        <p>
          <code>projectTree</code> turns commits supplied in any order into a forest. It indexes
          commits, finds the active path from the selected tip, associates named heads with their
          tips, sorts siblings by timestamp and object id, and recursively assigns depth. TUI uses
          that result to traverse branches, mark the active route, and show which head names point
          at each commit.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/client/src/views/tree.ts#L56-L103">
            client/views/tree.ts:56-103
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/tui/src/interactive.ts#L3109-L3110">
            tui/interactive.ts:3109-3110
          </a>
        </p>
        <p>
          <code>navigationTarget</code> computes a destination; <code>heads.move</code> publishes
          the move. Selecting an assistant, tool result, checkpoint, summary, completion, or config
          targets that commit. Selecting a user message targets its parent and returns the selected
          content for editing. Moving the ref does not delete old objects, but it also does not
          guarantee permanent recoverability. Current refs and retained ref events protect old tips;
          event trimming lowers that protection, and garbage collection can sweep unreferenced
          objects after its grace period. A product promise to recover replaced history needs an
          explicit history ref and retention policy.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/client/src/views/tree.ts#L114-L143">
            client/views/tree.ts:114-143
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/gc.ts#L38-L102">
            core/gc.ts:38-102
          </a>
        </p>
        <h3 {...props(styles.heading)}>What desktop does now</h3>
        <pre
          aria-label="Current desktop edit path"
          {...props(styles.trace)}
        >{`click a committed user message
  UserMessageView opens a full composer
  save
    applyMessageEdit
      heads.move(to: selected user commit)
        navigationTarget selects parent and restored content
        heads.move publishes the ref change
      sessions.configure queues passive model/thinking config
      plugins.settings.apply fast settings
      outbox.submit edited content
      reload thread`}</pre>
        <p>
          <strong>Fact.</strong> Desktop offers the edit callback to settled turns and to the
          trailing turn while work is live. The editor preserves the draft when save throws.{" "}
          <code>heads.move</code> rejects a nonterminal run as <code>busy</code>, so the current
          interaction lets the user finish editing and only then says "Wait for the current response
          before editing this message."{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/screens/thread.tsx#L886-L909">
            desktop/thread.tsx:886-909
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/conversation/turn-view.tsx#L226-L247">
            desktop/turn-view.tsx:226-247
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/nyte.ts#L513-L534">
            core/sdk/nyte.ts:513-534
          </a>
        </p>
        <p>
          Editing a queued message is a different operation. <code>messages.redeliver</code>{" "}
          rebuilds the affected queue suffix and publishes its new tip, cancellation markers, and
          supersession markers in one CAS. If the change already landed, it returns{" "}
          <code>landed</code> instead of rewriting committed history.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/conversation/composer.tsx#L896-L929">
            desktop/composer.tsx:896-929
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/queue.ts#L332-L445">
            core/queue.ts:332-445
          </a>
        </p>
        <p>
          There are two deeper problems. First, desktop calls <code>heads.move</code>, configuration
          changes, plugin setting changes, and <code>outbox.submit</code> separately. A failure
          after the move can leave the branch rewound without the replacement message. Second, the
          form does not send the tip it opened against, even though <code>heads.move</code> supports{" "}
          <code>expect</code>. A remote client can change the branch while the form remains open.
        </p>
        <h3 {...props(styles.heading)}>The recommended edit contract</h3>
        <p>
          <strong>Immediate mitigation.</strong> Desktop should capture the observed{" "}
          <code>runId</code> and form-open tip, pass <code>runId</code> to abort, wait for terminal
          settlement and lease release, and refuse an unreviewed tip change. Passing the original
          tip as <code>expect</code> is a safe interim guard, but even the stopped run's final
          commit can make it fail. That conservative mitigation alone does not deliver automatic
          stop-and-resend. It must reject a replacement run or unrelated remote edit. It must not
          refresh the snapshot and silently treat the latest tip as the user's original target.
        </p>
        <p>
          Desktop stop currently sends only <code>sessionId</code>, even though the protocol accepts{" "}
          <code>runId</code>. A delayed click can therefore abort a replacement run. TUI and mobile
          pass the observed run id. This is source-confirmed; the review did not reproduce the race.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/desktop/src/renderer/src/conversation/composer.tsx#L978-L981">
            desktop/composer.tsx:978-981
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/protocol/src/operations.ts#L188-L197">
            protocol/operations.ts:188-197
          </a>
        </p>
        <p>
          <strong>Durable contract.</strong> "Edit and resend" should be a core-owned operation
          lifecycle:
        </p>
        <ol>
          <li>
            Record the selected commit, original head tip, target run, edited content, idempotency
            key, and desired branch configuration.
          </li>
          <li>
            Request abort only for that run. While a network tool settles, authorize only progress
            that completes the target run. Do not admit unrelated work into the edit.
          </li>
          <li>
            Wait until the run reaches a terminal phase and its lease is released. "Abort requested"
            is not terminal settlement.
          </li>
          <li>
            Validate the current tip against the recorded original tip and the exact target-run
            publications admitted during stopping. Reject unrelated input, a new run, or a head
            move. Use the validated settled tip as the final CAS expectation, never an arbitrary
            latest snapshot. A conflict keeps the draft.
          </li>
          <li>
            When safe, use one CAS to publish the durable branch move, branch configuration, and
            replacement input. Retain the abandoned tip under an explicit history or recovery ref if
            the UX promises later recovery, with a stated retention policy.
          </li>
          <li>
            Report plugin-setting failure and external work honestly. Transcript rewind does not
            undo files, child sessions, background processes, MCP calls, notifications, or external
            APIs. Workspace tree restoration remains a separate operation.
          </li>
        </ol>
        <p>
          This lifecycle cannot be one database transaction across a waiting network tool. Its
          durable stages and preconditions make partial progress recoverable; the final branch,
          configuration, and input publication can still be atomic. Keep plugin-setting facts out of
          the edit's atomic scope. If the user also changes a plugin setting, apply it as a separate
          operation and wait for the relevant effective registry revision before resending. Storing
          the setting in the same CAS would still not make asynchronous MCP activation complete.
          Branch creation remains a separate explicit action. It should not be silently substituted
          for the requested stop-then-resend behavior.
        </p>
        <p>
          <strong>Recommendation.</strong> Replace the 5 ms lease-release loop with a local
          notification where available. A host still needs to observe release by another process and
          lease expiry after a crash, through backend notifications or bounded polling. Lease expiry
          must wake the waiter even when no process sends a notification.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/wait.ts#L9-L24">
            core/sdk/wait.ts:9-24
          </a>
        </p>
      </section>
      <section id="plugins">
        <h2 {...props(styles.heading)}>Plugins, skills, MCP, and reload</h2>
        <p>
          Plugins are part of turn construction, not an optional UI layer. Activation registries
          provide prompts, tools, agents, commands, resources, settings, model-context policy,
          status, and hooks. Skills contribute prompt-visible resources through that activation. MCP
          tools enter the same tool registry and durable effect path. Reload correctness therefore
          determines which prompt, schema, policy, and implementation a run uses.
        </p>
        <h3 {...props(styles.heading)}>Boot and activation</h3>
        <pre aria-label="Plugin activation call tree" {...props(styles.trace)}>{`DesktopHost.compose
  createHost -> createNyte with deferred plugin target
  first sessionPool.activationFor
    resolveSessionActivation -> deferred target.resolve
      pluginTarget requires trusted workspace
      watchPluginSources
      resolveHostPlugins
        read user + project manifest, load skills
        build built-ins, MCP plugin, skills plugin
        resolvePlugins discovers and imports entries
    activate
      create registries, hooks, facts, plugin event fanout
      PluginHost.activate -> bindSessionApi
        plugin.module.session(api)
        rebuildAll`}</pre>
        <p>
          Desktop resolves a plugin target only after its project workspace passes the host trust
          decision. TUI has a similar trust step before opening its host. The host merges manifests,
          loads skill files, creates built-ins for MCP and skills, discovers source entries, and
          imports plugin modules. Per-session activation binds a typed <code>SessionApi</code>, runs
          each plugin's session factory, then rebuilds effective registries.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/host/src/plugins.ts#L36-L71">
            host/plugins.ts:36-71
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/api.ts#L30-L90">
            core/plugins/api.ts:30-90
          </a>
        </p>
        <p>
          <strong>API boundary, not sandbox.</strong> The typed <code>SessionApi</code> limits what
          core promises to plugins. It does not confine loaded JavaScript.{" "}
          <code>loadPluginFile</code> imports source into the host process, where approved code has
          ambient Node file-system and network access. The workspace trust gate prevents automatic
          project-plugin activation before approval. It cannot make an approved malicious plugin
          safe. Moving reload lifecycle into a worker or process helps termination, but it becomes a
          security sandbox only if OS capabilities are also restricted.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/sources.ts#L131-L166">
            core/plugins/sources.ts:131-166
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/types.ts#L200-L235">
            core/plugins/types.ts:200-235
          </a>
        </p>
        <p>
          TUI also loads UI extensions through a separate <code>PluginProvider</code>. That API
          passes the full Nyte SDK, including host lifecycle operations, rather than the narrower
          session plugin API.
        </p>
        <h3 {...props(styles.heading)}>What reload does today</h3>
        <p>
          Installation currently means placing or symlinking files into configured plugin
          directories. There is no extension package manager with integrity records or per-plugin
          capability approval. Workspace trust permits host-process code execution; remote SDK
          permissions do not separately authorize those imports or model tool calls.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/plugin/examples/README.md#L1-L10">
            plugin/examples/README.md:1-10
          </a>
        </p>
        <p>
          The file watcher takes a plugin hold as soon as it schedules a change, then debounces and
          serializes rescans. Desktop reloads manifest, skills, built-ins, MCP configuration, and
          source entries before calling <code>host.setPlugins</code>. Core walks pooled sessions
          sequentially. Within each session, <code>PluginHost.activate</code> serializes activation,
          retains an identical id and version, disposes a changed instance, runs its replacement
          factory, removes missing plugins, rebuilds registries, and emits{" "}
          <code>plugins_changed</code>. If a changed plugin's session factory fails, it reruns the
          old factory. The watcher releases the hold after the final pending change.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/sources.ts#L224-L263">
            core/plugins/sources.ts:224-263
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/host.ts#L106-L176">
            core/plugins/host.ts:106-176
          </a>
        </p>
        <p>
          The hold blocks new <code>respond</code> and <code>tools</code> invocations while a known
          swap is pending. It does not block every kernel step or keep an assistant response and its
          tool calls on one plugin generation.
        </p>
        <h3 {...props(styles.heading)}>The generation gap</h3>
        <pre aria-label="Plugin generation race" {...props(styles.trace)}>{`respond phase
  resolveTurnConfig against generation A
  model sees A prompt and A tool schemas
  commit assistant tool call

reload generation B

tools phase
  resolveTurnConfig again against B
  same tool name may now mean different code or schema
  durable effect records name + args + replay, not generation`}</pre>
        <p>
          <strong>Inferred risk.</strong> Respond and tools resolve current configuration
          independently. A model can receive generation A's tool declaration, then the tools phase
          can execute generation B. The tool may be gone or may keep the same name while changing
          semantics. Hook snapshots can mix for the same reason. Plugin scope abort is separate from
          the run signal used for tool execution, so disposing A does not automatically stop a
          captured A tool. Current tests prove that a newly added tool appears on the next request
          and that reload during a live stream does not cancel that stream. They do not prove
          semantic consistency across the offered-call-execute boundary.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/activation.ts#L658-L672">
            core/sdk/activation.ts:658-672
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/runner.ts#L208-L237">
            core/sdk/runner.ts:208-237
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/test/kernel/session-relocation.test.ts#L186-L238">
            core/test/session-relocation.test.ts:186-238
          </a>
        </p>
        <p>
          <strong>Fact.</strong> An effect intent records tool name, arguments, and{" "}
          <code>safe</code> or <code>never</code> replay policy. It does not record plugin identity,
          declaration version, argument schema identity, or implementation generation.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/model.ts#L102-L145">
            core/model.ts:102-145
          </a>
        </p>
        <p>
          <strong>Recommendation.</strong> Pin one plugin revision for an assistant response and its
          tool calls, retain it while those calls run, and record its implementation identity in
          durable effects. Recovery needs both compatible code and current replay permission.
          Otherwise settle the call as interrupted unless an explicit migration supplies compatible
          behavior. Security revocation must take precedence over retaining an old revision. Each
          session needs a consistent revision; sessions need not reload simultaneously.
        </p>
        <h3 {...props(styles.heading)}>Last-good reload and source identity</h3>
        <p>
          <strong>Inferred risk.</strong> If a changed session factory fails, core has already
          disposed the old live instance. Rerunning the old factory can restore declarations but not
          its in-memory state. Import, syntax, or discovery failure is worse:{" "}
          <code>resolvePlugins</code> omits that entry from the candidate set, so activation treats
          it as removal and destroys the last-good instance. During async setup, registry maps and
          hooks can also expose different intermediate states because hook disposal is immediate
          while contribution maps rebuild later.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/sources.ts#L84-L98">
            core/plugins/sources.ts:84-98
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/host.ts#L124-L156">
            core/plugins/host.ts:124-156
          </a>
        </p>
        <p>
          Source identity hashes <code>mtimeMs:size</code>, despite a type comment describing source
          bytes. An edit with preserved timestamp and size can be missed. The version query
          refreshes the entry module, but Node's ESM cache can retain helper modules. Unchanged id
          and version also skips source path and order changes. TUI's separate UI extension loader
          fingerprints bytes, but that does not fix core plugin imports.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/sources.ts#L138-L155">
            core/plugins/sources.ts:138-155
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/tui/src/plugins.ts#L329-L380">
            tui/plugins.ts:329-380
          </a>
        </p>
        <p>
          <strong>Recommendation.</strong> Build a complete candidate in isolated draft registries
          without touching the live activation. Hash source bytes or a bundled versioned module
          graph. Only after discovery, import, and setup succeed should one atomic per-session
          publication replace contributions and hooks. Keep active and candidate status separate. On
          failure, leave the original live instance untouched. Drain cooperative calls; use worker
          or process isolation when reload must terminate uncooperative code. Staging registrations
          alone cannot undo arbitrary top-level imports or setup side effects. Candidate code must
          acquire resources through a controlled lifecycle or run behind an isolation boundary.
          Current <code>PluginScope.dispose</code> waits at most five seconds per cleanup; a timeout
          does not cancel the cleanup promise.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/scope.ts#L51-L84">
            core/plugins/scope.ts:51-84
          </a>
        </p>
        <h3 {...props(styles.heading)}>MCP and skills</h3>
        <pre
          aria-label="MCP enablement and tool exposure"
          {...props(styles.trace)}
        >{`readManifest -> resolveHostPlugins -> mcpPlugin.session
  register server settings
  McpServers.acquire -> stdio or HTTP connection
  rebuild tools, prompt, status

plugins.settings.apply
  persist desired enabled fact, return applied
  session event -> MCP listener
    acquire or release pooled connection
    rebuild effective registries
  next turnFor resolution reads those tools`}</pre>
        <p>
          MCP connections are process-owned and shared across sessions. Manifest configuration
          creates per-server settings, and a server is enabled by default unless its config
          explicitly disables it or a stored setting turns it off. Acquisition can start stdio or
          HTTP using host environment and working directory. Applying a setting writes the desired
          fact; an asynchronous plugin event later exposes or hides tools and updates prompt and
          status registries. <code>applied</code> therefore means the preference was stored, not
          that the effective MCP tool set is ready.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/activation.ts#L350-L358">
            core/sdk/activation.ts:350-358
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/plugin/src/mcp.ts#L407-L475">
            plugin/mcp.ts:407-475
          </a>
        </p>
        <h3 {...props(styles.heading)}>Registry rebuilds also repeat work</h3>
        <pre aria-label="MCP registry rebuild trace" {...props(styles.trace)}>{`MCP refresh
  api.tools.rebuild
    tools registry rebuild
    activation.rebuildAll
      every registry, including tools and status
  api.prompt.rebuild
    prompt registry rebuild
    activation.rebuildAll
      every registry again`}</pre>
        <p>
          <strong>Fact.</strong> The public registry wrapper calls <code>inner.rebuild</code>, then{" "}
          <code>target.rebuildAll</code>. MCP refresh calls that wrapper for tools and prompt. One
          refresh therefore triggers two complete registry passes plus the two requested rebuilds.
          Status refreshes in the global pass. This duplication is separate from projecting one
          durable event for multiple watchers. The two paths have different owners and fixes.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/api.ts#L36-L42">
            core/plugins/api.ts:36-42
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/activation.ts#L218-L234">
            core/sdk/activation.ts:218-234
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/plugin/src/mcp.ts#L440-L449">
            plugin/mcp.ts:440-449
          </a>
        </p>
        <p>
          <strong>Recommendation.</strong> Batch contribution changes into one ordered rebuild
          before publishing the new registry revision. Keep dependencies such as agents before
          tools. Deleting the global rebuild without preserving those dependencies would replace
          repeated work with stale state. Verify one contribution evaluation per batch and the same
          effective tools, prompt, and status before claiming a performance improvement.
        </p>
        <p>
          <strong>Recommendation.</strong> Report desired and effective MCP state with an activation
          revision. Provide a barrier when callers require the new registry before the next prompt.
          Diagnose sanitized-name collisions instead of allowing the last mapped tool to win. A
          catalog query for a prospective session should not spawn process-owned MCP work. Today{" "}
          <code>catalogForNewSession</code> activates plugin factories to read their catalog, so it
          can start a configured MCP process. <code>McpServers</code> is a module-global pool in
          host composition. No host-close path calls its <code>close</code> method. Final session
          handle release schedules transport closure after one second without awaiting it. SDK close
          is therefore not a transport-join guarantee. The process-level host owner should own and
          close the shared pool after all its SDK instances release it, rather than let one session
          close connections still used by another.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/kernel/sdk/session-pool.ts#L475-L497">
            core/sdk/session-pool.ts:475-497
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/plugin/src/mcp.ts#L141-L194">
            plugin/mcp.ts:141-194
          </a>
        </p>
        <p>
          Skills are data, not JavaScript plugins. The loader searches project and user directories,
          accepts metadata plus instructions and an absolute path, and keeps the first skill with a
          given name. The protocol currently sends full instruction bodies in resource listings even
          when completion needs only names and descriptions. A lightweight catalog plus explicit
          body fetch would reduce repeated payload and keep policy metadata separate from prompt
          text. Manifest plugin option objects are accepted by schema but not passed through
          resolution; either define that option contract or remove the unsupported shape.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/schema/src/index.ts#L20-L30">
            schema/index.ts:20-30
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/host/src/plugins.ts#L96-L113">
            host/plugins.ts:96-113
          </a>
        </p>
        <p>
          <strong>Client freshness.</strong> <code>skillDirectories</code> selects sources;{" "}
          <code>loadSkills</code> reads them; <code>skillsPlugin</code> registers resources and a
          model-visible catalog; <code>plugins.resources.list</code> supplies client completion
          data.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/src/plugins/builtin/skills.ts#L12-L28">
            core/plugins/builtin/skills.ts:12-28
          </a>{" "}
          Desktop and TUI use plugin notices to refresh their contribution queries. The shared
          session fold does not put <code>plugins_changed</code> into transcript state. Mobile has
          no corresponding completion invalidation, so its commands and skills may stay stale until
          another fetch or remount. A session-scoped catalog revision would give each client a
          refresh boundary distinct from the catalog for a prospective session.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/mobile/src/chat/completions.ts#L121-L145">
            mobile/completions.ts:121-145
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/client/src/session/session-state.ts#L366-L379">
            client/session-state.ts:366-379
          </a>
        </p>
      </section>
      <section id="pi">
        <h2 {...props(styles.heading)}>What to borrow from Pi, and what not to copy</h2>
        <p>
          The comparison is pinned to Pi commit{" "}
          <a href="https://github.com/earendil-works/pi/tree/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e">
            <code>2b04ce27fbeff3d1180e6a67ba34d7db5a62528e</code>
          </a>
          . Pico v5 is unimplemented at that commit; the available experimental implementation is
          Pico 3. The coding agent's <code>/reload</code> refuses while streaming or compacting,
          then tears down and rebuilds an idle session runtime.{" "}
          <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/agent/docs/pico-v5.md#L175-L179">
            pico-v5.md:175-179
          </a>{" "}
          <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L5972-L5980">
            interactive-mode.ts:5972-5980
          </a>{" "}
          <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/coding-agent/src/core/agent-session.ts#L2881-L2905">
            agent-session.ts:2881-2905
          </a>
        </p>
        <ul>
          <li>
            <strong>Borrow declaration identity.</strong> Pico v5 separates a durable tool
            declaration from process implementation and invocation ownership. Its proposed recovery
            requires both stored and current permission before replay. See{" "}
            <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/agent/docs/pico-v5.md#L1221-L1350">
              pico-v5.md:1221-1350
            </a>
            .
          </li>
          <li>
            <strong>Borrow staged reload ownership.</strong> The proposal freezes new work, joins
            invocations and watches, disposes the old runtime, registers a complete replacement,
            then resumes. See{" "}
            <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/agent/docs/pico-v5.md#L1435-L1468">
              pico-v5.md:1435-1468
            </a>
            .
          </li>
          <li>
            <strong>Keep ownership edges specific.</strong> Invocation cancellation, waiter
            cancellation, child lifetime, and durable abort are not one recursive "cancel everything
            below here" relation. Pi's distinction between history and runtime parentage is useful.
            See{" "}
            <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/agent/docs/pico-v5.md#L1098-L1132">
              pico-v5.md:1098-1132
            </a>
            .
          </li>
          <li>
            <strong>Do not import the generic document kernel.</strong> Nyte already has objects,
            refs, leases, effects, inbox delivery, and checkpoint semantics. A broad mutable
            document API would give plugins more authority and create a second persistence model.
          </li>
          <li>
            <strong>Do not drop the durable event journal.</strong> Desktop, TUI, mobile, and remote
            cloud clients need independent cursors, snapshots, expiry recovery, and durable deltas
            or progress. Process-local plugin notices solve another problem.
          </li>
          <li>
            <strong>Do not replace Nyte's run machine with a generic task scheduler.</strong> Run
            phases, response budgets, admission, fencing, and checkpoints encode product rules that
            a generic scheduler would have to rediscover.
          </li>
        </ul>
        <p>
          Pico 3's implemented semantic projection and Chord bridge are not evidence that Pico 5's
          replacement works.{" "}
          <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/agent/src/harness/pico3/view.ts#L72-L140">
            pico3/view.ts:72-140
          </a>{" "}
          <a href="https://github.com/earendil-works/pi/blob/2b04ce27fbeff3d1180e6a67ba34d7db5a62528e/packages/agent/src/harness/pico3/chord.ts#L70-L143">
            pico3/chord.ts:70-143
          </a>{" "}
          Nyte can adopt explicit plugin revision and ownership rules without replacing its durable
          execution model.
        </p>
      </section>
      <section id="proof">
        <h2 {...props(styles.heading)}>Verification harness</h2>
        <p>
          <strong>Baseline acceptance run.</strong> Four files containing 16 tests passed against
          SQLite and the worker-backed store. That is 32 passing executions. Twelve drills use
          public or hybrid operations; four delegation drills reach internal seams needed to force
          authorization races. They should not all be described as end-to-end tests.
        </p>
        <p>
          The harness uses <code>scripted</code> to create controlled provider event streams, opens
          real temporary stores, drives work to idle through public <code>advance</code>, and can
          pause a real ref CAS with <code>gateRefUpdate</code>. That gate makes publication races
          reproducible without mocking their outcomes.{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/test/kernel/acceptance-helpers.ts#L24-L84">
            core/test/acceptance-helpers.ts:24-84
          </a>{" "}
          <a href="https://github.com/interfaces-lab/nyte/blob/c02321f624bc66e632195a0467e6831206c015a0/packages/core/test/kernel/acceptance-helpers.ts#L103-L152">
            core/test/acceptance-helpers.ts:103-152
          </a>
        </p>
        <table {...props(styles.table)}>
          <thead>
            <tr>
              <th {...props(styles.cell)}>File</th>
              <th {...props(styles.cell)}>What it proves</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td {...props(styles.cell)}>
                <code>acceptance-concurrency.test.ts</code>
              </td>
              <td {...props(styles.cell)}>
                100 concurrent sends form lossless chains; a send during streaming stays pending; a
                concurrent head move defeats publication; takeover fences stale refs and events;
                cancel versus land has one winner.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>acceptance-effects-events.test.ts</code>
              </td>
              <td {...props(styles.cell)}>
                <code>safe</code> and <code>never</code> recovery differ; parked waits survive and
                accept one signal; independent cursors converge; an expired raw watch rejects, then
                a manually acquired snapshot and watch fold recover the state. This does not test
                automatic <code>SessionObserver</code> recovery.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>acceptance-history.test.ts</code>
              </td>
              <td {...props(styles.cell)}>
                A branch is stale when its saved base differs from its parent's tip; fast-forward is
                atomic; garbage collection respects its grace period.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>acceptance-delegation.test.ts</code>
              </td>
              <td {...props(styles.cell)}>
                Continuation authorization is consumed once and revoked on owner failure; abort can
                prevent a child request from publishing; unauthorized answers stay inert; two hosts
                still permit one continuation. Revoking an already-published authorization on abort
                is not established by that abort drill.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          The acceptance drills cover CAS, fencing, effect recovery, cursor reconstruction, and
          authorization. Core must also guard the following invariants; the retry item has unit
          coverage, not restart or takeover acceptance coverage:
        </p>
        <ul>
          <li>A multi-ref CAS publishes all requested ref changes or none.</li>
          <li>A newer fence prevents an old owner from publishing refs, events, or effects.</li>
          <li>
            Tool intent precedes execution; replay policy distinguishes safe replay, interruption,
            and settled-result reuse.
          </li>
          <li>
            A waiting generation identified by <code>waitId</code> has one signal winner.
          </li>
          <li>
            Continuation authorization is consumed with landing, revoked on failure or abort, and
            charged to a root response budget.
          </li>
          <li>
            Retries persist attempt accounting and deadline budget; abort does not wait for retry
            backoff.
          </li>
        </ul>
        <p>
          <strong>Proof gaps.</strong> The acceptance set does not cover retry across process
          restart or takeover, a checkpoint-versus-edit race, a noncooperating tool, real external
          effects, a full public subagent journey, browser stop-edit-resend, or projected-tail
          performance. Retry does have unit coverage, so the gap is specifically restart and
          takeover acceptance coverage.
        </p>
      </section>
      <section id="corrections">
        <h2 {...props(styles.heading)}>Obsolete claims corrected</h2>
        <table {...props(styles.table)}>
          <thead>
            <tr>
              <th {...props(styles.cell)}>Earlier claim or concern</th>
              <th {...props(styles.cell)}>Finding at the source baseline</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td {...props(styles.cell)}>
                The review is on <code>refactor/core-boundary</code>.
              </td>
              <td {...props(styles.cell)}>
                The baseline is <code>main</code> at{" "}
                <code>c02321f624bc66e632195a0467e6831206c015a0</code>.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                Named workbench and turn fixes are uncommitted or in flight.
              </td>
              <td {...props(styles.cell)}>
                The described behavior is present in the pinned source. The old staging and
                in-flight lists do not describe this checkout.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>There are 12 kernel acceptance tests.</td>
              <td {...props(styles.cell)}>
                There are 16 tests across four acceptance files. Running both configured stores
                produced 32 passing executions.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>runs.wait</code> and relocation call <code>decide</code> directly.
              </td>
              <td {...props(styles.cell)}>
                <code>landsNow</code> reuses <code>headFor</code>, <code>leadFor</code>,{" "}
                <code>agentChanged</code>, and <code>decide</code> for wait and relocation checks.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                Jobs and delegation duplicate one <code>owed → claimed → delivered</code> machine.
              </td>
              <td {...props(styles.cell)}>
                Jobs have <code>owed</code>, <code>claimed</code>, and <code>delivered</code>.
                Delegation has <code>owed</code> and <code>delivered</code>. Similar delivery
                concerns do not make them the same state machine.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>Host Git code lacks a shared runner.</td>
              <td {...props(styles.cell)}>
                Both <code>host/git.ts:57-109</code> and <code>tree-snapshot.ts:50-117</code>{" "}
                already have <code>runGit</code>. The remaining question is whether the two runners
                and their hardening should be consolidated, not whether to introduce a runner.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>Desktop main is IPC transport only.</td>
              <td {...props(styles.cell)}>
                Desktop main also owns target routing, local and remote host lifecycle, workspace
                trust, models, plugins, runners, mobile sharing, and session ownership.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                The SDK docs import transcript helpers from the wrong package.
              </td>
              <td {...props(styles.cell)}>
                At the baseline, the SDK example imports transcript helpers from client and{" "}
                <code>CursorExpired</code> from protocol.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                The client reprojects a snapshot transcript from history.
              </td>
              <td {...props(styles.cell)}>
                <code>stateFromSnapshot</code> wraps the transcript already present in the snapshot.
                Repeated work occurs in live per-subscriber event projection.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>There are exactly two projection maps.</td>
              <td {...props(styles.cell)}>
                There is no supported universal "two maps" count. There are <em>N</em> public watch
                projections, plus one per SDK/session activation with plugin event subscribers. The
                same event can therefore take more than two projection paths across hosts.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>
                <code>SqlStore</code> is unused.
              </td>
              <td {...props(styles.cell)}>
                It is an internal base for <code>SqliteStore</code>. Lack of direct imports does not
                make its behavior unused.
              </td>
            </tr>
            <tr>
              <td {...props(styles.cell)}>Pico v5 is Pi's current architecture.</td>
              <td {...props(styles.cell)}>
                At the pinned Pi commit, Pico v5 is an unimplemented proposal. Current code exports
                Pico 3.
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section id="fixes">
        <h2 {...props(styles.heading)}>Prioritized fixes and acceptance criteria</h2>
        <ol>
          <li>
            <strong>Target stop, then add durable edit-and-resend.</strong> Immediately pass the
            observed <code>runId</code> and original tip. Then add the recoverable core lifecycle
            described above, ending with one CAS for branch, configuration, and input.{" "}
            <em>Acceptance:</em> browser tests cover delayed stop, replacement run, remote head
            move, duplicate save, failed setting update, and network-tool settlement. No delayed
            action aborts a replacement run, and no failure leaves an unexplained partial rewind.
          </li>
          <li>
            <strong>Pin plugin revision through response and execution.</strong> Use one revision
            for the tools advertised to the model and the implementations that execute its calls.
            Record plugin, schema, and implementation identity in the durable intent.{" "}
            <em>Acceptance:</em> pause after the model receives generation A's tools, reload B under
            the same names, and prove execution uses retained A or stops as incompatible. Restarted
            waits obey the same rule.
          </li>
          <li>
            <strong>Partition remote tenants before shared multi-user exposure.</strong> Keep
            principal-aware authorization in server and host routing, backed by tenant-keyed storage
            or isolated principal-bound stores. Recheck long-lived watch access.{" "}
            <em>Acceptance:</em> two principals cannot list, open, watch, mutate, or infer each
            other's sessions, and revocation ends an existing watch. No new user model is required
            inside the kernel.
          </li>
          <li>
            <strong>Make reload preserve the actual last-good instance.</strong> Build
            byte-identified candidate modules and contributions in isolation, then publish one
            per-session revision. <em>Acceptance:</em> syntax, discovery, and setup failures leave
            the original instance and state active; Node and Bun both load helper edits;
            contribution collisions produce diagnostics; host shutdown joins process-owned MCP
            transport.
          </li>
          <li>
            <strong>Batch registry contribution rebuilds.</strong> A single MCP refresh should not
            run every registry twice through the public rebuild wrappers. Preserve registry
            dependency order and publish one complete revision. <em>Acceptance:</em> every
            contribution runs once per batch, while tools, prompt, and status converge to the same
            effective state and failures remain attributed to the owning plugin.
          </li>
          <li>
            <strong>Bound desktop event delivery.</strong> Add credit or pull flow control to IPC
            and make overflow request a snapshot rather than drop events. <em>Acceptance:</em> a
            paused renderer has bounded memory, committed state converges after resume, and an
            overflow produces an explicit resnapshot.
          </li>
          <li>
            <strong>Make lease waiting event-driven where possible.</strong> Use local release
            notifications with a cross-process wakeup or bounded fallback and an expiry deadline.{" "}
            <em>Acceptance:</em> waits settle after local release, remote release, or owner failure;
            release racing subscription cannot leave a waiter stuck. No busy 5 ms polling loop.
          </li>
          <li>
            <strong>Measure before pooling live projection.</strong> Instrument graph reads, object
            reads, projection time, and retained queue size. <em>Acceptance:</em> any pooled tail
            preserves independent replay, slow-consumer isolation, cursor expiry, equal-sequence
            barriers, and resnapshot recovery.
          </li>
          <li>
            <strong>Close package and client seams.</strong> Derive protocol types from
            authoritative schemas where practical, use the worker package entry in TUI, remove
            unjustified protocol pass-throughs and deep test imports, disambiguate{" "}
            <code>SessionInfo</code>, choose one <code>toJsonValue</code> owner, and add activation
            revision to client catalogs. <em>Acceptance:</em> all five entry imports compile, schema
            drift fails typecheck, packaged TUI resolves the worker export, no test crosses packages
            by relative source path, and mounted mobile completion refreshes after plugin change.
          </li>
        </ol>
      </section>
      <section id="quiz">
        <h2 {...props(styles.heading)}>Knowledge check</h2>
        <details>
          <summary {...props(styles.question)}>
            True or false: <code>messages.send</code> can succeed while the message remains pending.
          </summary>
          <div>
            <strong>True.</strong> A successful send publishes the input to the inbox. Landing later
            creates commits and advances the conversation head, inbox base, and run ref in one CAS.
            Writing an unreachable object alone would not be a successful send.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            Which component decides whether input joins a live run or starts another one? A.
            Desktop, B. the provider loop, C. kernel admission, D. <code>SessionObserver</code>.
          </summary>
          <div>
            <strong>C. Kernel admission.</strong> <code>headFor</code>, <code>leadFor</code>,{" "}
            <code>agentChanged</code>, and <code>decide</code> produce the landing decision. Clients
            submit intent; the provider loop handles one turn after the kernel chooses it.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            True or false: <code>stateFromSnapshot</code> reuses the transcript in the snapshot
            without walking commit history.
          </summary>
          <div>
            <strong>True.</strong> It wraps <code>snapshot.transcript</code> as{" "}
            <code>&#123; items, tip &#125;</code>. Live public events are folded afterward.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            In one session activation, three public watchers and one plugin event subscriber produce
            how many live projection paths? A. one, B. two, C. three, D. four.
          </summary>
          <div>
            <strong>D. Four.</strong> Each public watcher owns a raw watch and projection.
            Activation creates one additional watch for all plugin listeners. Runner watches inspect
            raw refs and do not add another public projection.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            True or false: a successful abort request proves files and external effects were rolled
            back.
          </summary>
          <div>
            <strong>False.</strong> The request marks the run and propagates cancellation. Terminal
            publication later becomes <code>aborted</code>. Fencing blocks stale durable writes, but
            neither mechanism undoes files, processes, MCP calls, or external APIs.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            Why does selecting a user message navigate to its parent rather than to the message
            itself?
          </summary>
          <div>
            The selected content is returned for restoration and resend. Moving to the parent
            removes the old user message and later answers from the active path. Current refs and
            retained ref events may still protect those objects, but guaranteed recovery requires an
            explicit ref and retention policy.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            Which edit behavior is recommended during streaming? A. reject only after save, B.
            rewrite the head immediately, C. stop the captured run, await settlement, check the tip,
            then resend, D. always create a hidden branch.
          </summary>
          <div>
            <strong>C.</strong> It stops only the selected run, preserves the draft on conflict, and
            waits for terminal execution before changing history. A separately requested branch
            operation remains available.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            True or false: a tool name and JSON arguments are enough to prove safe replay after
            plugin reload.
          </summary>
          <div>
            <strong>False.</strong> The same name can resolve to different code. A replay decision
            needs an effective implementation contract and explicit compatibility with the stored
            intent.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            MCP refresh calls tools.rebuild and prompt.rebuild. What runs today? A. only those two
            registries, B. every registry once, C. every registry twice plus two local rebuilds.
          </summary>
          <div>
            <strong>C.</strong> Each public registry wrapper rebuilds its own registry and then
            calls <code>rebuildAll</code>. MCP invokes two wrappers. Status therefore refreshes
            indirectly too. Batching must preserve dependencies, not simply remove the global pass.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            True or false: an MCP setting result of <code>applied</code> proves the next prompt sees
            the new tool set.
          </summary>
          <div>
            <strong>False.</strong> <code>applied</code> means the desired fact was stored. MCP
            reacts asynchronously and later rebuilds effective tools, prompt, and status. A
            readiness barrier or effective activation revision would make that transition
            observable.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            What does the plugin hold guarantee during reload? A. one revision for the response and
            its tools, B. cancellation of old tools, C. migration of incompatible calls, D. no new
            respond or tools invocation until the pending swap ends.
          </summary>
          <div>
            <strong>D.</strong> Respond and tools resolve current activation separately. The hold
            blocks new provider and tool invocations during a known swap, but no durable generation
            binds the offered declaration to later execution.
          </div>
        </details>
        <details>
          <summary {...props(styles.question)}>
            True or false: a valid bearer token makes the Vercel demo safe for unrelated users
            sharing one Postgres store.
          </summary>
          <div>
            <strong>False.</strong> The token authenticates access to the server, but it does not
            create principals or partition sessions. Secure multi-user hosting needs
            principal-scoped routing and storage plus watch revocation.
          </div>
        </details>
      </section>
    </main>
  );
}
