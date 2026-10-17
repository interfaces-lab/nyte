import type { ExoticComponent } from "react";

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

/** React sets this flag on a fiber whose render function ran in the commit. */
const PERFORMED_WORK = 1;

const watched = new Map<Fiber["elementType"], { mounts: number; updates: number }>();

let committedAt = 0;

/** When React last committed, on the `performance.now()` clock. */
export function lastCommit(): number {
  return committedAt;
}

/**
 * Renders of `component` since the last `resetRenders`, first mounts and
 * re-renders apart, counted from React's devtools commit hook. Import this
 * module before `react-dom`: React reads the hook once, when it loads.
 */
export function renderCount(component: ExoticComponent<never>): {
  mounts: number;
  updates: number;
} {
  return watched.get(component) ?? { mounts: 0, updates: 0 };
}

/** Start counting `component` from zero. */
export function resetRenders(component: ExoticComponent<never>): void {
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
