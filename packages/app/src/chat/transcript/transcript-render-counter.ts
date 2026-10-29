import type { ExoticComponent, FunctionComponent } from "react";

type Component = ExoticComponent<never> | FunctionComponent<never>;

interface Fiber {
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
  readonly alternate: Fiber | null;
  readonly elementType: object | string | null;
  readonly flags: number;
}

interface FiberRoot {
  readonly current: Fiber;
}

const PERFORMED_WORK = 1;

const watched = new Map<Fiber["elementType"], { mounts: number; updates: number }>();

let committedAt = 0;

export function lastCommit(): number {
  return committedAt;
}

export function renderCount(component: Component): {
  mounts: number;
  updates: number;
} {
  return watched.get(component) ?? { mounts: 0, updates: 0 };
}

export function resetRenders(component: Component): void {
  watched.set(component, { mounts: 0, updates: 0 });
}

function visit(next: Fiber, previous: Fiber | null): void {
  const counts = watched.get(next.elementType);

  if (counts !== undefined && previous === null) counts.mounts += 1;
  else if (counts !== undefined && (next.flags & PERFORMED_WORK) !== 0) counts.updates += 1;

  if (previous !== null && next.child === previous.child) return;

  for (let child = next.child; child !== null; child = child.sibling) visit(child, child.alternate);
}

Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
  value: {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => undefined,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    onCommitFiberRoot: (_renderer: number, root: FiberRoot) => {
      visit(root.current, root.current.alternate);
      committedAt = performance.now();
    },
  },
});
