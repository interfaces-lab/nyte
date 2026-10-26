/**
 * One settings page drawn around its hub: the illustration and a headline
 * that follows the page's state, then the app's connection rows, one per
 * source. Connections are simulated: progress advances on a timer and walks
 * through each source's steps, and toasts go through the app's toaster.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import {
  useEffect,
  useEffectEvent,
  useReducer,
  useState,
  type ActionDispatch,
  type ReactElement,
} from "react";
import { ConnectionMenu, ConnectionRow } from "@nyte-ai/app/chrome/connection-list.tsx";
import { settingsStyles } from "@nyte-ai/app/settings/settings.stylex.ts";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { MenuItem } from "@nyte-ai/ui/menu";
import { toast } from "@nyte-ai/ui/toast";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { avatar, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { HubArt, type ArtNode, type Link } from "./hub-art";
import { HubStrip, hasHubStrip } from "./hub-strips";
import { plural, type Copy, type Scene, type Source } from "./scenes";

const TICK_MS = 50;

/** A toast a tick decided on; the tick posts it to the toaster. */
interface Announcement {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description: string;
}

interface State {
  readonly loading: boolean;
  readonly links: Readonly<Record<string, Link>>;
}

type Action =
  | { readonly kind: "loaded" }
  | { readonly kind: "start"; readonly id: string }
  | { readonly kind: "stop"; readonly id: string }
  | { readonly kind: "tick"; readonly ms: number };

const IDLE: Link = { kind: "idle" };

function initial(scene: Scene): State {
  return {
    loading: true,
    links: Object.fromEntries(scene.sources.map((source) => [source.id, IDLE])),
  };
}

function readLink(state: State, id: string): Link {
  return state.links[id] ?? IDLE;
}

function attempts(link: Link): number {
  return link.kind === "working" ? link.attempt : link.kind === "failed" ? 2 : 1;
}

function advance(scene: Scene, state: State, ms: number) {
  const announcements: Announcement[] = [];

  const links = Object.fromEntries(
    scene.sources.map((source): [string, Link] => {
      const link = readLink(state, source.id);

      if (link.kind !== "working") return [source.id, link];
      const progress = Math.min(1, link.progress + ms / (source.seconds * 1000));

      if (source.failsOnce !== undefined && link.attempt === 1 && progress >= 0.62) {
        announcements.push({
          type: "error",
          title: `Couldn't connect ${source.title}`,
          description: source.failsOnce,
        });

        return [source.id, { kind: "failed", progress, message: source.failsOnce }];
      }

      if (progress < 1) return [source.id, { ...link, progress }];
      announcements.push({
        type: "success",
        title: `Connected ${source.title}`,
        description: source.result,
      });

      return [source.id, { kind: "on" }];
    }),
  );

  return { links, announcements };
}

function reducer(scene: Scene) {
  return (state: State, action: Action): State => {
    switch (action.kind) {
      case "loaded":
        return { ...state, loading: false };
      case "start": {
        const link = readLink(state, action.id);

        if (link.kind === "working" || link.kind === "on") return state;

        return {
          ...state,
          links: {
            ...state.links,
            [action.id]: { kind: "working", progress: 0, attempt: attempts(link) },
          },
        };
      }

      case "stop":
        return { ...state, links: { ...state.links, [action.id]: IDLE } };
      case "tick":
        return { ...state, links: advance(scene, state, action.ms).links };
      default: {
        const _exhaustive: never = action;

        return _exhaustive;
      }
    }
  };
}

interface Summary {
  readonly connected: number;
  readonly working: number;
  readonly amount: number;
  readonly progress: number;
}

function summarize(scene: Scene, state: State): Summary {
  const shares = scene.sources.map((source) => {
    const link = readLink(state, source.id);
    const share = link.kind === "on" ? 1 : link.kind === "working" ? link.progress : 0;

    return { link, share, amount: Math.round(source.amount * share) };
  });

  return {
    connected: shares.filter((entry) => entry.link.kind === "on").length,
    working: shares.filter((entry) => entry.link.kind === "working").length,
    amount: shares.reduce((total, entry) => total + entry.amount, 0),
    progress: shares.reduce((total, entry) => total + entry.share, 0) / scene.sources.length,
  };
}

function headline(scene: Scene, state: State, summary: Summary): Copy {
  if (state.loading) return scene.loading;

  if (summary.working > 0) return scene.working(summary.working);

  if (summary.connected === scene.sources.length) return scene.ready;

  return summary.connected === 0 ? scene.empty : scene.partial(summary.connected);
}

function currentStep(source: Source, progress: number): string {
  const index = Math.min(source.steps.length - 1, Math.floor(progress * source.steps.length));

  return source.steps[index] ?? source.steps[0];
}

function SourceRow({
  scene,
  source,
  link,
  dispatch,
}: {
  readonly scene: Scene;
  readonly source: Source;
  readonly link: Link;
  readonly dispatch: ActionDispatch<[Action]>;
}): ReactElement {
  const start = (): void => dispatch({ kind: "start", id: source.id });
  const stop = (): void => dispatch({ kind: "stop", id: source.id });
  const name = <span {...props(srOnly)}> {source.title}</span>;

  const detail =
    link.kind === "working"
      ? `${currentStep(source, link.progress)}…`
      : link.kind === "failed"
        ? link.message
        : link.kind === "on"
          ? source.result
          : source.detail;

  const control =
    link.kind === "idle" ? (
      <Button variant="outline" onClick={start}>
        {scene.connect}
        {name}
      </Button>
    ) : link.kind === "working" ? (
      <Button variant="outline" onClick={stop}>
        Cancel
        {name}
      </Button>
    ) : link.kind === "failed" ? (
      <Button variant="outline" icon="refresh" onClick={start}>
        Retry
        {name}
      </Button>
    ) : (
      <ConnectionMenu label={source.title} tone="on" status="Connected">
        <MenuItem variant="danger" onClick={stop}>
          {scene.disconnect}
        </MenuItem>
      </ConnectionMenu>
    );

  return (
    <ConnectionRow
      glyph={<Icon name={source.icon} size={20} />}
      title={source.title}
      detail={detail}
      control={control}
    />
  );
}

function SkeletonRow(): ReactElement {
  return (
    <ConnectionRow
      glyph={<span aria-hidden="true" {...props(styles.skeleton, styles.skeletonGlyph)} />}
      title={<span aria-hidden="true" {...props(styles.skeleton, styles.skeletonTitle)} />}
      detail={<span aria-hidden="true" {...props(styles.skeleton, styles.skeletonDetail)} />}
    />
  );
}

export function HubSettings({
  scene,
  loadMs,
  art,
}: {
  readonly scene: Scene;
  readonly loadMs: number;
  /** The strip across the top, or the isometric hub inside the headline card. */
  readonly art: "strip" | "hub";
}): ReactElement {
  const [state, dispatch] = useReducer(reducer(scene), scene, initial);
  const [traced, setTraced] = useState<string | undefined>(undefined);
  const summary = summarize(scene, state);
  const copy = headline(scene, state, summary);
  const syncing = summary.working > 0;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- fake load timer, restarted per load time
  useEffect(() => {
    const timer = window.setTimeout(() => dispatch({ kind: "loaded" }), loadMs);

    return () => window.clearTimeout(timer);
  }, [loadMs]);

  const tick = useEffectEvent(() => {
    for (const entry of advance(scene, state, TICK_MS).announcements) toast.add(entry);
    dispatch({ kind: "tick", ms: TICK_MS });
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- progress interval while an item syncs
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(tick, TICK_MS);

    return () => window.clearInterval(timer);
  }, [syncing]);

  const traceRow = (list: HTMLElement, target: EventTarget | null): void => {
    if (!(target instanceof Node)) return;
    const index = Array.from(list.children).findIndex((row) => row.contains(target));

    setTraced(scene.sources[index]?.id);
  };

  const nodes: readonly ArtNode[] = scene.sources.map((source) => ({
    id: source.id,
    icon: source.icon,
    slot: source.slot,
    link: readLink(state, source.id),
  }));

  const strip = art === "strip" && hasHubStrip(scene.id) ? scene.id : undefined;

  return (
    <>
      {strip !== undefined && (
        <HubStrip
          scene={strip}
          nodes={nodes}
          progress={summary.progress}
          loading={state.loading}
          focus={traced}
        />
      )}
      <section {...props(settingsPatterns.section)}>
        <div aria-busy={state.loading} {...props(settingsPatterns.group)}>
          {strip === undefined && (
            <div {...props(styles.art)}>
              <HubArt
                form={scene.hub.form}
                icon={scene.hub.icon}
                loading={state.loading}
                progress={summary.progress}
                focus={traced}
                nodes={nodes}
              />
            </div>
          )}
          <div aria-live="polite" {...props(settingsPatterns.rowRule, settingsPatterns.row)}>
            <span {...props(settingsPatterns.rowCopy)}>
              <span {...props(settingsPatterns.rowTitle)}>{copy.title}</span>
              <span {...props(settingsPatterns.rowDescription)}>{copy.body}</span>
            </span>
            {!state.loading && summary.amount > 0 && (
              <span {...props(settingsPatterns.rowControl)}>
                <span {...props(settingsStyles.rowValue, styles.count)}>
                  {plural(summary.amount, scene.unit)}
                </span>
              </span>
            )}
          </div>
        </div>
      </section>

      <section {...props(settingsPatterns.section)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <h2 {...props(settingsPatterns.sectionTitle)}>{scene.list}</h2>
        </div>
        <div
          {...props(settingsPatterns.group)}
          onPointerOver={(event) => traceRow(event.currentTarget, event.target)}
          onPointerLeave={() => setTraced(undefined)}
          onFocus={(event) => traceRow(event.currentTarget, event.target)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setTraced(undefined);
          }}
        >
          {scene.sources.map((source) =>
            state.loading ? (
              <SkeletonRow key={source.id} />
            ) : (
              <SourceRow
                key={source.id}
                scene={scene}
                source={source}
                link={readLink(state, source.id)}
                dispatch={dispatch}
              />
            ),
          )}
        </div>
      </section>
    </>
  );
}

const shimmer = keyframes({ "0%, 100%": { opacity: 0.55 }, "50%": { opacity: 1 } });

const styles = create({
  art: { paddingBlock: space.s4, paddingInline: space.s6 },
  count: { marginInlineEnd: 0 },
  skeleton: {
    display: "block",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    animationName: { default: shimmer, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
  },
  skeletonGlyph: { width: avatar.md, height: avatar.md },
  skeletonTitle: { width: "35%", height: 12, marginBlock: space.s1 },
  skeletonDetail: { width: "60%", height: 10, marginBlock: space.s1 },
});
