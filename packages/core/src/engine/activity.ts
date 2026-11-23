import { asId } from "@nyte-ai/schema";
import type { Disposer, HostActivity } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";

export const RETIRING_MS = 1000;

export async function hostActivity(kernel: Kernel): Promise<HostActivity> {
  const workspaces = (await kernel.store.refs.list("workspaces/")).map((ref) =>
    asId<"workspace">(ref.name.slice("workspaces/".length)),
  );

  const running = workspaces.flatMap((workspace) =>
    kernel.jobs.list(workspace).filter((job) => job.view.state.kind === "running"),
  );

  const working = await Promise.all(
    running.map(async (job) => job.view.pty === null || !(await job.process.idle())),
  );

  return {
    runs: kernel.executionState.driving.size,
    jobs: working.filter((busy) => busy).length,
  };
}

export async function retireHost(kernel: Kernel): Promise<boolean> {
  const state = kernel.executionState;
  state.retiring = true;
  const activity = await hostActivity(kernel);
  state.retiring = activity.runs === 0 && activity.jobs === 0;

  return state.retiring;
}

export function onActivity(kernel: Kernel, listener: () => void): Disposer {
  const settles = kernel.executionState.settles;
  settles.add(listener);

  return () => {
    settles.delete(listener);
  };
}

export function activitySettled(kernel: Kernel): void {
  for (const listener of kernel.executionState.settles) listener();
}
