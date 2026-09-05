import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceRegistry } from '/Users/workgyver/Developer/nyte/packages/core/src/workspace-registry.ts';
import { WorkspaceTrustStore } from '/Users/workgyver/Developer/nyte/packages/core/src/workspace-trust.ts';

const base = await mkdtemp(join(tmpdir(), 'nyte-core-registry-audit-'));
try {
  const one = join(base, 'one');
  const two = join(base, 'two');
  await Promise.all([mkdir(one), mkdir(two)]);
  for (const [name, Store, action] of [
    ['registry', WorkspaceRegistry, 'touch'],
    ['trust', WorkspaceTrustStore, 'trust'],
  ]) {
    const counts = [];
    for (let i = 0; i < 10; i++) {
      const file = join(base, `${name}-${i}.json`);
      const a = new Store(file);
      const b = new Store(file);
      await Promise.all([a[action](one), b[action](two)]);
      counts.push(Object.keys(JSON.parse(await readFile(file, 'utf8'))).length);
    }
    console.log(name, JSON.stringify({ expectedEntries: 2, persistedEntryCounts: counts }));
  }
} finally {
  await rm(base, { recursive: true, force: true });
}
