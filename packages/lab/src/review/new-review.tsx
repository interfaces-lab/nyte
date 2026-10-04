/**
 * Opening a pull request on a branch you already have, or on a run of its
 * commits, from the Review page. Nothing leaves this machine: the pull
 * request is faked, with no push and nothing on GitHub.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { input, radius, row } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import { useCompare, useCreateReview } from "./api";
import { count, plural } from "./files";
import type { Repo } from "./wire";

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
    backgroundColor: role.bgBase,
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
});
