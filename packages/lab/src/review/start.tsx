/**
 * Starting a review: the screen with no review open, and the dialog that
 * creates one from a branch. A review starts one of two ways. Give Nyte a
 * task, and it builds it on a new branch in a worktree of its own; the review
 * follows that branch. Or review a branch that exists, or a run of its
 * commits, against the base it merges into. Nothing leaves this machine: no
 * push, no pull request on GitHub.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, Textarea } from "@nyte-ai/ui/input";
import { input, radius, row } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import { useCompare, useCreateReview, useStartTask } from "./api";
import { count, plural, when } from "./files";
import type { Branch, Repo } from "./wire";

/** Past this many files a guide gets long; the dialog says so before anything runs. */
const LARGE = 150;

const TIP = "tip";

const FIRST = "first";

/**
 * A native select: the browser draws its list above every layer, labels it
 * from the `<label>`, and gives it the platform's keyboard model.
 */
function Picker({
  label,
  value,
  items,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <label {...props(styles.field)}>
      <span {...props(styles.label)}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...props(styles.select)}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NewReviewForm({
  repo,
  initialBranch,
  onCreated,
}: {
  readonly repo: Repo;
  readonly initialBranch: string | undefined;
  readonly onCreated: (id: string) => void;
}): ReactElement {
  const [branch, setBranch] = useState(initialBranch ?? repo.branches[0]?.name ?? "");
  const [newest, setNewest] = useState(TIP);
  const [oldest, setOldest] = useState(FIRST);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const create = useCreateReview();
  const all = useCompare(repo.base, branch);
  const commits = all.data?.commits ?? [];
  const newestIndex = newest === TIP ? 0 : commits.findIndex((entry) => entry.oid === newest);

  const oldestIndex =
    oldest === FIRST ? commits.length - 1 : commits.findIndex((entry) => entry.oid === oldest);

  const headRef = newest === TIP ? branch : newest;
  const baseRef = oldest === FIRST ? repo.base : (commits[oldestIndex]?.parents[0] ?? repo.base);
  const range = useCompare(baseRef, headRef);
  const chosen = commits.slice(newestIndex, oldestIndex + 1);
  const suggested = chosen.length === 1 ? (chosen[0]?.subject ?? branch) : branch;
  const name = title ?? suggested;

  const branchItems = repo.branches.map((entry) => ({
    value: entry.name,
    label: `${entry.name} · ${plural(entry.ahead, "commit", "commits")}`,
  }));

  const newestItems = [
    { value: TIP, label: "Latest, and any new commits" },
    ...commits
      .slice(0, oldestIndex + 1)
      .map((entry) => ({ value: entry.oid, label: `${entry.short} ${entry.subject}` })),
  ];

  const oldestItems = [
    { value: FIRST, label: `All commits since ${repo.base}` },
    ...commits
      .slice(newestIndex)
      .map((entry) => ({ value: entry.oid, label: `${entry.short} ${entry.subject}` })),
  ];

  return (
    <form
      {...props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          { title: name.trim() === "" ? suggested : name, base: baseRef, head: headRef },
          { onSuccess: (created) => onCreated(created.id) },
        );
      }}
    >
      <Dialog.Title>New review</Dialog.Title>
      <Dialog.Description xstyle={styles.description}>
        Compare a branch against <span translate="no">{repo.base}</span>. Narrow it to a run of
        commits to keep the guide focused.
      </Dialog.Description>

      <Picker
        label="Branch"
        value={branch}
        items={branchItems}
        onChange={(next) => {
          setBranch(next);
          setNewest(TIP);
          setOldest(FIRST);
        }}
      />

      <div {...props(styles.pair)}>
        <Picker label="Newest commit" value={newest} items={newestItems} onChange={setNewest} />
        <Picker label="Oldest commit" value={oldest} items={oldestItems} onChange={setOldest} />
      </div>

      <label {...props(styles.field)}>
        <span {...props(styles.label)}>Title</span>
        <Input value={name} onChange={(event) => setTitle(event.currentTarget.value)} />
      </label>

      <div role="status" {...props(styles.preview)}>
        {range.data === undefined ? (
          range.error !== null ? (
            range.error.message
          ) : (
            <>
              <Spinner /> Measuring the change
            </>
          )
        ) : (
          <>
            <span>
              {plural(range.data.commits.length, "commit", "commits")} ·{" "}
              {plural(range.data.files, "file", "files")}
            </span>
            <span {...props(styles.counts)}>
              <span {...props([intent.success, styles.count])}>+{count(range.data.added)}</span>
              <span {...props([intent.danger, styles.count])}>−{count(range.data.removed)}</span>
            </span>
          </>
        )}
      </div>
      {range.data !== undefined && range.data.files > LARGE && (
        <p {...props(styles.warning)}>
          <Icon name="warning" size={14} xstyle={styles.warningIcon} />
          Guides past {LARGE} files get long and slow. Pick a newer oldest commit to narrow it.
        </p>
      )}
      {create.error !== null && (
        <p role="alert" {...props(styles.error)}>
          {create.error.message}
        </p>
      )}

      <div {...props(styles.actions)}>
        <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
        <Button type="submit" variant="solid" tone="primary" loading={create.isPending}>
          Create review
        </Button>
      </div>
    </form>
  );
}

export function NewReview({
  repo,
  open,
  initialBranch,
  onOpenChange,
  onCreated,
}: {
  readonly repo: Repo | undefined;
  readonly open: boolean;
  readonly initialBranch: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (id: string) => void;
}): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup xstyle={styles.popup}>
        {repo !== undefined && open && (
          <NewReviewForm
            key={initialBranch ?? ""}
            repo={repo}
            initialBranch={initialBranch}
            onCreated={onCreated}
          />
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function BranchRow({
  branch,
  onReview,
}: {
  readonly branch: Branch;
  readonly onReview: () => void;
}): ReactElement {
  return (
    <li {...props(styles.branch)}>
      <div {...props(styles.branchBody)}>
        <span translate="no" {...props(styles.branchName)}>
          {branch.name}
        </span>
        <span title={branch.subject} {...props(styles.branchMeta)}>
          {branch.subject} · {when(branch.at)}
        </span>
      </div>
      <span {...props(styles.ahead)}>{plural(branch.ahead, "commit", "commits")}</span>
      <Button variant="outline" onClick={onReview}>
        Review
      </Button>
    </li>
  );
}

/** A task for Nyte: it branches from `base`, works in a worktree of its own, and the review follows. */
function TaskForm({
  repo,
  onStarted,
}: {
  readonly repo: Repo;
  readonly onStarted: (id: string) => void;
}): ReactElement {
  const [task, setTask] = useState("");
  const [base, setBase] = useState(repo.current ?? repo.base);
  const start = useStartTask();

  const bases = [
    ...new Set([repo.current, repo.base, ...repo.branches.map((entry) => entry.name)]),
  ].flatMap((name) => (name === undefined ? [] : [{ value: name, label: name }]));

  return (
    <form
      {...props(styles.task)}
      onSubmit={(event) => {
        event.preventDefault();

        if (task.trim() === "") return;

        start.mutate(
          { task: task.trim(), base },
          { onSuccess: (created) => onStarted(created.id) },
        );
      }}
    >
      <label {...props(styles.field)}>
        <span {...props(styles.label)}>Task</span>
        <Textarea
          rows={4}
          value={task}
          placeholder="What should Nyte change?"
          onChange={(event) => setTask(event.currentTarget.value)}
        />
      </label>
      <div {...props(styles.taskRow)}>
        <Picker label="Start from" value={base} items={bases} onChange={setBase} />
        <Button
          type="submit"
          variant="solid"
          tone="primary"
          loading={start.isPending}
          xstyle={styles.taskSubmit}
        >
          Start
        </Button>
      </div>
      {start.error !== null && (
        <p role="alert" {...props(styles.error)}>
          {start.error.message}
        </p>
      )}
    </form>
  );
}

export function Start({
  repo,
  offline,
  onNew,
  onStarted,
}: {
  readonly repo: Repo | undefined;
  readonly offline: string | undefined;
  readonly onNew: (branch: string | undefined) => void;
  readonly onStarted: (id: string) => void;
}): ReactElement {
  if (offline !== undefined)
    return (
      <div {...props(styles.start)}>
        <h1 {...props(styles.heading)}>The review core is offline</h1>
        <p {...props(styles.lede)}>{offline}</p>
      </div>
    );

  return (
    <div {...props(styles.start)}>
      <h1 {...props(styles.heading)}>Review a change</h1>
      <p {...props(styles.lede)}>
        Give Nyte a task and review what it builds, or review a branch you already have. Nyte reads
        the change once and writes a guide; every question you ask starts from that reading.
      </p>
      {repo === undefined ? (
        <p role="status" {...props(styles.loading)}>
          <Spinner /> Reading branches
        </p>
      ) : (
        <>
          <section aria-labelledby="review-task" {...props(styles.branches)}>
            <h2 id="review-task" {...props(styles.subheading)}>
              Give Nyte a task
            </h2>
            <TaskForm repo={repo} onStarted={onStarted} />
          </section>
          <section aria-labelledby="review-branches" {...props(styles.branches)}>
            <div {...props(styles.sectionHead)}>
              <h2 id="review-branches" {...props(styles.subheading)}>
                Review a branch
              </h2>
              <Button variant="outline" icon="plus" onClick={() => onNew(undefined)}>
                New review
              </Button>
            </div>
            {repo.branches.length > 0 && (
              <ul {...props(styles.branchList)}>
                {repo.branches.map((branch) => (
                  <BranchRow
                    key={branch.name}
                    branch={branch}
                    onReview={() => onNew(branch.name)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const styles = create({
  popup: { width: "min(560px, calc(100vw - 48px))" },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  description: { textWrap: "pretty" },
  field: { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 },
  pair: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 12,
  },
  label: { color: role.contentPrimary, fontSize: type.fontSm, fontWeight: 500 },
  select: {
    width: "100%",
    minWidth: 0,
    height: input.heightMd,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderControl,
    borderRadius: input.radiusMd,
    backgroundColor: role.bgControl,
    color: role.contentPrimary,
    font: "inherit",
    fontSize: type.fontSm,
    textOverflow: "ellipsis",
    cursor: appearance.cursorInteractive,
  },
  preview: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: row.heightMd,
    padding: "8px 12px",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  counts: { display: "inline-flex", gap: 6, marginInlineStart: "auto" },
  count: {
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  warning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textWrap: "pretty",
  },
  warningIcon: { marginBlockStart: 2, color: role.contentSecondary },
  error: { margin: 0, color: role.contentSecondary, fontSize: type.fontSm },
  actions: { display: "flex", justifyContent: "flex-end", gap: 12, marginBlockStart: 4 },
  start: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 720,
    marginInline: "auto",
    paddingInline: 28,
    paddingBlock: "64px 96px",
    overflowY: "auto",
  },
  heading: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: type.letterLg,
    textWrap: "balance",
  },
  lede: {
    margin: 0,
    maxWidth: "60ch",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: 1.6,
    textWrap: "pretty",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  branches: { display: "flex", flexDirection: "column", gap: 8, marginBlockStart: 24 },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  task: { display: "flex", flexDirection: "column", gap: 12 },
  taskRow: { display: "flex", alignItems: "flex-end", gap: 12 },
  taskSubmit: { flexShrink: 0 },
  subheading: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: 500,
  },
  branchList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  branch: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: row.heightLg,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
  },
  branchBody: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  branchName: {
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    overflowWrap: "anywhere",
  },
  branchMeta: {
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ahead: {
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
});
