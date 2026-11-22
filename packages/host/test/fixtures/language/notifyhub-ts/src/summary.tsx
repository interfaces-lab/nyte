import type { Stats } from "./stats.ts";

function Panel(props: { readonly title: string; readonly children?: number }) {
  return `${props.title}: ${props.children ?? 0}`;
}

export function renderSummary(stats: Stats) {
  return <Panel title="Delivered">{stats.total.delivered}</Panel>;
}
