import { SqliteStore } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts';
import { createNyte } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts';
import { sessionId } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/types.ts';
import type { Store, Session } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/store.ts';
import { step } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/step.ts';
import { DEFAULT_LANDING } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/types.ts';
import { runRef } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/names.ts';
import { branch } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/graph.ts';
import { headRef } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/names.ts';
import { pending, pendingIn } from '/Users/workgyver/Developer/nyte/packages/core/src/kernel/queue.ts';
import type { Api, Model } from '/Users/workgyver/Developer/nyte/packages/schema/src/index.ts';
const backend = new SqliteStore(':memory:');
await (await backend.create({ id: 'race' })).close();
let opened = 0;
const closed: number[] = [];
const store: Store = {
  create: (input) => backend.create(input),
  list: () => backend.list(),
  delete: (id) => backend.delete(id),
  close: () => backend.close(),
  async open(id) {
    const session = await backend.open(id);
    const index = ++opened;
    return { ...session, close: async () => { closed.push(index); await session.close(); } } satisfies Session;
  },
};
const model: Model<Api> = {
  id: 'echo', name: 'Echo', api: 'openai-responses', provider: 'openai',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000,
};
const nyte = await createNyte({ store, model, models: { getModels: () => [model], getModel: () => model }, streamFn: () => { throw new Error('Not invoked'); }, plugins: [], env: { cwd: '/tmp' } });
const id = sessionId('race');
const [first, retry] = await Promise.all([nyte.messages.send({ sessionId: id, content: 'prompt-a', agent: 'agent-a', key: 'key-a' }), nyte.messages.send({ sessionId: id, content: 'prompt-b', agent: 'agent-b', key: 'key-b' })]);
const inspect = await backend.open(id);
console.log(JSON.stringify({ first, retry, queued: (await pendingIn(inspect, { head: 'main', lane: 'steer' })).map(item => item.change.body) }));
await step(inspect, { respond: async () => { throw new Error('Not invoked'); }, tools: async () => { throw new Error('Not invoked'); } }, { head: 'main', landing: DEFAULT_LANDING });
const runOid = await inspect.refs.read(runRef('main'));
console.log(JSON.stringify({ landed: (await branch(inspect.objects, await inspect.refs.read(headRef('main')))).map(item => item.commit.body) }));
console.log(JSON.stringify({ firstRun: runOid === null ? null : await inspect.objects.get(runOid) }));
await inspect.close();
console.log(JSON.stringify({ beforeClose: { opened, closed } }));
await nyte.close();
console.log(JSON.stringify({ afterClose: { opened, closed } }));
await backend.close();
