/**
 * One review: the branch and how much you have reviewed, Approve, then the
 * tab row. The tab row carries the page's own controls at its end: "⋯" for
 * how diffs draw, and the workbench toggle for the side chat, the way the app
 * puts them beside its tabs rather than inside a panel.
 *
 * Mount it with `key={review.id}` so another review starts from its own tab,
 * draft, selection and reviewed marks.
 */
import { create, props } from "@stylexjs/stylex";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { ActivityTab } from "./activity";
import { useApprove, usePatches, useSideChat } from "./api";
import type { CodeReference } from "./code";
import { CommitList } from "./commits";
import { DiffStack } from "./diff-stack";
import { count, reviewFiles, useReviewed } from "./files";
import { ReviewGuide, type GuideFiles } from "./guide";
import { SideChat } from "./side-chat";
import type { Brief, Guide, ReviewDetail } from "./wire";

type Tab = "activity" | "guide" | "changes" | "commits";

const isTab = (value: unknown): value is Tab =>
  value === "activity" || value === "guide" || value === "changes" || value === "commits";

const withGuide = (brief: Brief | undefined): brief is Brief & { readonly guide: Guide } =>
  brief?.guide !== undefined;

export function ReviewView({
  review,
  root,
  version,
}: {
  readonly review: ReviewDetail;
  readonly root: string;
  readonly version: number;
}): ReactElement {
  const [tab, setTab] = useState<Tab>("guide");
  const [commit, setCommit] = useState<string | undefined>(undefined);
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [treeVisible, setTreeVisible] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [references, setReferences] = useState<readonly CodeReference[]>([]);
  const [draft, setDraft] = useState("");
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(new Map());

  const [reveal, setReveal] = useState<{
    readonly path: string | undefined;
    readonly count: number;
  }>({ path: undefined, count: 0 });

  const composer = useRef<HTMLTextAreaElement>(null);
  const approve = useApprove(review.id);
  const turns = useSideChat(review, version);

  const { revision } = review;
  const current = review.briefs.find((brief) => brief.head === revision.head);

  // The newest guide on this base: the head's own, or an earlier head's while the next is written.
  const shown = withGuide(current)
    ? current
    : review.revisions
        .filter((entry) => entry.base === revision.base)
        .map((entry) => review.briefs.find((brief) => brief.head === entry.head))
        .findLast(withGuide);

  // What changed since the guide on screen: since its own head when it is behind, else since the brief it was cut from.
  const since =
    shown === undefined ? undefined : shown.head === revision.head ? shown.from : shown.head;

  const picked = review.commits.find((entry) => entry.short === commit);
  const empty = revision.head === revision.base;
  const approved = review.approvals.at(-1)?.head === revision.head;

  const all = usePatches(review.id, empty ? undefined : revision.base, revision.head);
  const single = usePatches(review.id, picked?.parents[0], picked?.oid);
  const moved = usePatches(review.id, since, since === undefined ? undefined : revision.head);

  const files = useMemo(
    () => reviewFiles(all.data?.patches ?? [], revision.base, revision.head),
    [all.data, revision.base, revision.head],
  );

  const commitFiles = useMemo(
    () =>
      picked === undefined || single.data === undefined
        ? undefined
        : reviewFiles(single.data.patches, picked.parents[0] ?? revision.base, picked.oid),
    [picked, single.data, revision.base],
  );

  const updated = new Set(
    (moved.data?.patches ?? []).filter((entry) => entry.patch !== "").map((entry) => entry.path),
  );

  const marks = useReviewed(review.id, files);
  const allCollapsed = files.length > 0 && files.every((file) => opened.get(file.path) === false);

  const addReference = (reference: CodeReference): void => {
    if (
      references.some(
        (entry) =>
          entry.path === reference.path &&
          entry.side === reference.side &&
          entry.start === reference.start &&
          entry.end === reference.end,
      )
    )
      return;

    setReferences([...references, reference]);
    setChatOpen(true);
  };

  const toggle = (path: string, fallback: boolean): void =>
    setOpened(new Map(opened).set(path, !(opened.get(path) ?? fallback)));

  const input: GuideFiles = {
    files,
    reviewed: marks.reviewed,
    onReviewed: (path, next) => marks.setReviewed([path], next),
    collapsed: (path, fallback) => opened.get(path) ?? fallback,
    onToggle: toggle,
    justUpdated: (path) => updated.has(path) && marks.reviewed(path) !== "reviewed",
    onOpenInDiff: (path) => {
      setCommit(undefined);
      setTab("changes");
      setReveal({ path, count: reveal.count + 1 });
    },
    onReference: addReference,
  };

  return (
    <div {...props(styles.view)}>
      <FileTypeIconSprite />
      <div {...props(styles.main)}>
        <Tabs.Root
          value={tab}
          onValueChange={(next) => {
            if (isTab(next)) setTab(next);
          }}
          variant="pill"
          xstyle={styles.tabsRoot}
        >
          <div {...props(styles.bar)}>
            <Icon name="git-branch" size={14} xstyle={styles.barIcon} />
            <span translate="no" {...props(styles.ref)}>
              {review.headRef}
            </span>
            <span {...props(styles.into)}>
              into <span translate="no">{review.baseRef}</span>
            </span>
            <span {...props(styles.spacer)} />
            {files.length > 0 && (
              <span {...props(styles.progress)}>
                <span {...props(styles.progressText)}>
                  {count(marks.count)} of {count(files.length)} reviewed
                </span>
                <span aria-hidden="true" {...props(styles.meter)}>
                  <span {...props(styles.meterFill(`${(marks.count / files.length) * 100}%`))} />
                </span>
              </span>
            )}
            <Button
              variant="outline"
              icon={approved ? "checkmark" : undefined}
              disabled={empty || approved}
              loading={approve.isPending}
              onClick={() => approve.mutate({ head: revision.head })}
            >
              {approved ? "Approved" : "Approve"}
            </Button>
          </div>
          <div {...props(styles.tabs)}>
            <Tabs.List aria-label="Review">
              <Tabs.Tab value="activity">Activity</Tabs.Tab>
              <Tabs.Tab value="guide">Guide</Tabs.Tab>
              <Tabs.Tab value="changes">
                Changes <span {...props(styles.tabCount)}>{count(review.files.length)}</span>
              </Tabs.Tab>
              <Tabs.Tab value="commits">
                Commits <span {...props(styles.tabCount)}>{count(review.commits.length)}</span>
              </Tabs.Tab>
            </Tabs.List>
            <span {...props(styles.spacer)} />
            <Menu>
              <MenuTrigger
                render={<Button iconOnly icon="more-horizontal" aria-label="Review options" />}
              />
              <MenuContent align="end">
                <MenuSub>
                  <MenuSubTrigger
                    icon="split-right"
                    value={layout === "split" ? "Split" : "Unified"}
                  >
                    Layout
                  </MenuSubTrigger>
                  <MenuSubContent>
                    <MenuRadioGroup
                      value={layout}
                      onValueChange={(value) => setLayout(value === "split" ? "split" : "unified")}
                    >
                      <MenuRadioItem value="unified">Unified</MenuRadioItem>
                      <MenuRadioItem value="split">Split</MenuRadioItem>
                    </MenuRadioGroup>
                  </MenuSubContent>
                </MenuSub>
                <MenuCheckboxItem
                  checked={treeVisible}
                  closeOnClick={false}
                  onCheckedChange={setTreeVisible}
                >
                  Show File Tree
                </MenuCheckboxItem>
                <MenuItem
                  icon={allCollapsed ? "expand" : "minimize"}
                  onClick={() =>
                    setOpened(new Map(files.map((file) => [file.path, !allCollapsed])))
                  }
                >
                  {allCollapsed ? "Expand All Files" : "Collapse All Files"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon="copy"
                  onClick={() => void navigator.clipboard.writeText(review.headRef)}
                >
                  Copy Branch Name
                </MenuItem>
                {review.author !== undefined && (
                  <MenuItem
                    icon="folder"
                    onClick={() =>
                      void navigator.clipboard.writeText(review.author?.worktree ?? "")
                    }
                  >
                    Copy Worktree Path
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
            <Toggle
              iconOnly
              indicator="glyph"
              aria-label={chatOpen ? "Close side chat" : "Open side chat"}
              pressed={chatOpen}
              onPressedChange={setChatOpen}
            >
              <PanelToggleIcon side="right" visible={chatOpen} />
            </Toggle>
          </div>
          <Tabs.Panel value="activity" xstyle={styles.panel}>
            <ActivityTab review={review} turns={turns} />
          </Tabs.Panel>
          <Tabs.Panel value="guide" xstyle={styles.panel}>
            <ReviewGuide
              review={review}
              current={current}
              shown={shown}
              version={version}
              input={input}
              onAsk={(section) => {
                setDraft(`About “${section}”: `);
                setChatOpen(true);
                composer.current?.focus();
              }}
            />
          </Tabs.Panel>
          <Tabs.Panel value="changes" xstyle={styles.panel}>
            {empty ? (
              <p {...props(styles.note)}>No commits yet.</p>
            ) : all.error !== null ? (
              <p role="alert" {...props(styles.note)}>
                {all.error.message}
              </p>
            ) : (picked !== undefined && commitFiles === undefined) || all.isPending ? (
              <p role="status" {...props(styles.note)}>
                <Spinner /> Loading changes
              </p>
            ) : (
              <DiffStack
                key={reveal.count}
                files={commitFiles ?? files}
                commits={review.commits.map((entry) => ({
                  oid: entry.short,
                  subject: entry.subject,
                }))}
                commit={commit}
                onCommit={setCommit}
                layout={layout}
                treeVisible={treeVisible}
                reviewed={marks.reviewed}
                onReviewed={marks.setReviewed}
                collapsed={(path) => opened.get(path) ?? marks.reviewed(path) === "reviewed"}
                onToggle={(path) => toggle(path, marks.reviewed(path) === "reviewed")}
                justUpdated={input.justUpdated}
                reveal={reveal.path}
                onReference={addReference}
              />
            )}
          </Tabs.Panel>
          <Tabs.Panel value="commits" xstyle={styles.panel}>
            {empty ? (
              <p {...props(styles.note)}>No commits yet.</p>
            ) : (
              <CommitList
                commits={review.commits}
                onOpen={(oid) => {
                  setCommit(review.commits.find((entry) => entry.oid === oid)?.short);
                  setTab("changes");
                }}
              />
            )}
          </Tabs.Panel>
        </Tabs.Root>
      </div>
      {chatOpen && (
        <SideChat
          review={review}
          root={root}
          turns={turns}
          draft={draft}
          onDraft={setDraft}
          references={references}
          onReferences={setReferences}
          composer={composer}
        />
      )}
    </div>
  );
}

const styles = create({
  view: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  main: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  tabsRoot: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    flexShrink: 0,
  },
  barIcon: { color: role.contentSecondary },
  ref: {
    minWidth: 0,
    overflow: "hidden",
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  into: { flexShrink: 0, fontFamily: type.fontMono, fontSize: type.fontXs, whiteSpace: "nowrap" },
  spacer: { flex: 1 },
  progress: { display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 },
  progressText: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  meter: {
    display: "block",
    width: 64,
    height: 4,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
  meterFill: (share: string) => ({
    display: "block",
    inlineSize: share,
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  }),
  tabs: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingInline: "14px 10px",
    paddingBlock: 10,
    flexShrink: 0,
  },
  tabCount: {
    marginInlineStart: 4,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  panel: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: 28,
    color: role.contentSecondary,
  },
});
