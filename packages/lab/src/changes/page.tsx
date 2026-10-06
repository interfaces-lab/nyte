/**
 * Twelve takes on the desktop Changes tab, side by side, each changing one or two
 * ideas against the shipped panel (`packages/app/src/workbench/changes-*.tsx`).
 * Every panel reads the same working tree from `fixtures.ts`; state is local.
 */
import { create, defaultMarker, props, when } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import {
  BRANCH,
  FILES,
  MESSAGE,
  TOTAL,
  byFolder,
  splitPath,
  type ChangedFile,
  type FileStatus,
} from "./fixtures";

const hover = when.ancestor(":hover");

function Stat({
  added,
  removed,
  quiet = false,
}: {
  readonly added: number;
  readonly removed: number;
  readonly quiet?: boolean;
}): ReactElement {
  if (quiet)
    return (
      <span {...props(styles.stat, styles.quiet)}>
        +{added} −{removed}
      </span>
    );

  return (
    <span {...props(styles.stat)}>
      {added > 0 && <span {...props(intent.success, styles.tone)}>+{added}</span>}
      {removed > 0 && <span {...props(intent.danger, styles.tone)}>−{removed}</span>}
    </span>
  );
}

function IconButton({ icon, label }: { readonly icon: IconName; readonly label: string }): ReactElement {
  return <Button size="sm" icon={icon} iconOnly aria-label={label} />;
}

function HeaderActions(): ReactElement {
  return (
    <span {...props(styles.actions)}>
      <IconButton icon="refresh" label="Refresh" />
      <IconButton icon="more-horizontal" label="More" />
      <IconButton icon="panel-right" label="Hide panel" />
    </span>
  );
}

function FileName({ path, dim = true }: { readonly path: string; readonly dim?: boolean }): ReactElement {
  const { dir, base } = splitPath(path);

  return (
    <span {...props(styles.name)} title={path}>
      <span {...props(styles.base)}>{base}</span>
      {dim && dir !== "" && <span {...props(styles.dir)}>{dir}</span>}
    </span>
  );
}

const STATUS_LETTER: Readonly<Record<FileStatus, string>> = {
  modified: "M",
  added: "A",
  deleted: "D",
};

const STATUS_INTENT = {
  modified: intent.warning,
  added: intent.success,
  deleted: intent.danger,
} as const satisfies Readonly<Record<FileStatus, (typeof intent)[keyof typeof intent]>>;

function StatusLetter({ status }: { readonly status: FileStatus }): ReactElement {
  return (
    <span {...props(STATUS_INTENT[status], styles.letter)} aria-label={status}>
      {STATUS_LETTER[status]}
    </span>
  );
}

/** Five blocks, GitHub style: green and red in proportion, grey for the rest. */
function Blocks({ added, removed }: { readonly added: number; readonly removed: number }): ReactElement {
  const total = added + removed;
  const scale = Math.min(5, Math.ceil(total / 60));
  const green = total === 0 ? 0 : Math.round((added / total) * scale);
  const red = scale - green;

  return (
    <span {...props(styles.blocks)} aria-hidden>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          {...props(
            styles.block,
            index < green && intent.success,
            index >= green && index < green + red && intent.danger,
            index < green + red ? styles.blockOn : styles.blockOff,
          )}
        />
      ))}
    </span>
  );
}

/** The shipped row: file glyph, name, stat, revert, checkbox. Variants override slots. */
function FileRow({
  file,
  leading,
  trailing,
  stat,
  dim,
}: {
  readonly file: ChangedFile;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly stat?: ReactNode;
  readonly dim?: boolean;
}): ReactElement {
  return (
    <div {...props(styles.row, defaultMarker())}>
      <span {...props(styles.leading)}>
        {leading ?? <Icon name="file" size={16} xstyle={styles.fileIcon} />}
      </span>
      <FileName path={file.path} dim={dim} />
      {stat ?? <Stat added={file.added} removed={file.removed} />}
      {trailing}
    </div>
  );
}

function HoverActions({ children }: { readonly children: ReactNode }): ReactElement {
  return <span {...props(styles.hoverActions)}>{children}</span>;
}

function useChecks(): {
  readonly checked: ReadonlySet<string>;
  readonly toggle: (path: string) => void;
} {
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(FILES.filter((file) => file.staged).map((file) => file.path)),
  );

  return {
    checked,
    toggle: (path) =>
      setChecked((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return next;
      }),
  };
}

function ScopeChip(): ReactElement {
  return (
    <button type="button" {...props(styles.scopeChip)}>
      <Icon name="git" size={14} />
      <span {...props(styles.scopeLabel)}>Uncommitted</span>
      <Stat added={TOTAL.added} removed={TOTAL.removed} />
      <Icon name="chevron-down" size={12} xstyle={styles.chevron} />
    </button>
  );
}

function BranchLabel(): ReactElement {
  return (
    <span {...props(styles.branch)}>
      <Icon name="git-branch" size={14} />
      {BRANCH.name}
    </span>
  );
}

function ShippedHeader(): ReactElement {
  return (
    <div {...props(styles.header)}>
      <ScopeChip />
      <BranchLabel />
      <HeaderActions />
    </div>
  );
}

function MessageField({
  value,
  onChange,
  placeholder = "Commit message",
  trailing,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly trailing?: ReactNode;
}): ReactElement {
  return (
    <label {...props(styles.field)}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        {...props(styles.input)}
      />
      {trailing}
    </label>
  );
}

function PrimaryButton({
  children,
  disabled,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
}): ReactElement {
  return (
    <span {...props(styles.split)}>
      <button type="button" disabled={disabled} {...props(styles.primary, styles.primaryMain)}>
        {children}
      </button>
      <button
        type="button"
        aria-label="More commit actions"
        disabled={disabled}
        {...props(styles.primary, styles.primaryMenu)}
      >
        <Icon name="chevron-down" size={14} />
      </button>
    </span>
  );
}

/* 1 */
function Composer(): ReactElement {
  const [message, setMessage] = useState(MESSAGE);
  const ready = message.trim() !== "";

  return (
    <>
      <ShippedHeader />
      <div {...props(styles.commit)}>
        <MessageField
          value={message}
          onChange={setMessage}
          trailing={
            <span {...props(styles.inlineActions)}>
              <button type="button" {...props(styles.inlineMenu)}>
                Commit & Push
                <Icon name="chevron-down" size={12} />
              </button>
              <button
                type="button"
                aria-label="Commit and push"
                disabled={!ready}
                {...props(styles.send, ready && styles.sendReady)}
              >
                <Icon name="arrow-up" size={14} />
              </button>
            </span>
          }
        />
      </div>
      <List />
    </>
  );
}

function List({ dim = true }: { readonly dim?: boolean }): ReactElement {
  const { checked, toggle } = useChecks();

  return (
    <div {...props(styles.list)}>
      {FILES.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          dim={dim}
          trailing={
            <>
              <HoverActions>
                <IconButton icon="refresh" label="Discard changes" />
              </HoverActions>
              <Checkbox
                aria-label={`Include ${file.path}`}
                checked={checked.has(file.path)}
                onCheckedChange={() => toggle(file.path)}
              />
            </>
          }
        />
      ))}
    </div>
  );
}

/* 2 */
function Docked(): ReactElement {
  const [message, setMessage] = useState("");

  return (
    <>
      <ShippedHeader />
      <List />
      <div {...props(styles.dock)}>
        <MessageField value={message} onChange={setMessage} placeholder="Describe this change" />
        <PrimaryButton disabled={message.trim() === ""}>Commit and Push</PrimaryButton>
      </div>
    </>
  );
}

/* 3 */
function QuietHeader(): ReactElement {
  const [message, setMessage] = useState(MESSAGE);

  return (
    <>
      <div {...props(styles.quietHeader, defaultMarker())}>
        <div {...props(styles.quietTitle)}>
          <button type="button" {...props(styles.plainTrigger)}>
            Uncommitted
            <Icon name="chevron-down" size={12} xstyle={styles.chevron} />
          </button>
          <span {...props(styles.hoverActions)}>
            <HeaderActions />
          </span>
        </div>
        <span {...props(styles.subline)}>
          {FILES.length} files · <Stat added={TOTAL.added} removed={TOTAL.removed} quiet /> · on{" "}
          {BRANCH.name}
        </span>
      </div>
      <div {...props(styles.commit)}>
        <MessageField value={message} onChange={setMessage} />
        <PrimaryButton>Commit and Push</PrimaryButton>
      </div>
      <List />
    </>
  );
}

/* 4 */
function StatusLetters(): ReactElement {
  const { checked, toggle } = useChecks();

  return (
    <>
      <ShippedHeader />
      <CommitBlock />
      <div {...props(styles.list)}>
        {FILES.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            leading={<StatusLetter status={file.status} />}
            stat={<Stat added={file.added} removed={file.removed} quiet />}
            trailing={
              <span
                {...props(
                  styles.revealCheck,
                  checked.has(file.path) ? null : styles.revealOnHover,
                )}
              >
                <Checkbox
                  aria-label={`Include ${file.path}`}
                  checked={checked.has(file.path)}
                  onCheckedChange={() => toggle(file.path)}
                />
              </span>
            }
          />
        ))}
      </div>
    </>
  );
}

function CommitBlock({ label = "Commit and Push" }: { readonly label?: string }): ReactElement {
  const [message, setMessage] = useState(MESSAGE);

  return (
    <div {...props(styles.commit)}>
      <MessageField value={message} onChange={setMessage} />
      <PrimaryButton disabled={message.trim() === ""}>{label}</PrimaryButton>
    </div>
  );
}

/* 5 */
function Sections(): ReactElement {
  const [staged, setStaged] = useState<ReadonlySet<string>>(
    () => new Set(FILES.filter((file) => file.staged).map((file) => file.path)),
  );
  const move = (path: string): void =>
    setStaged((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const groups = [
    { title: "Staged", files: FILES.filter((file) => staged.has(file.path)), action: "Unstage" },
    { title: "Changes", files: FILES.filter((file) => !staged.has(file.path)), action: "Stage" },
  ] as const;

  return (
    <>
      <ShippedHeader />
      <CommitBlock label={`Commit ${String(staged.size)} Staged and Push`} />
      {groups.map((group) => (
        <div key={group.title} {...props(styles.section)}>
          <div {...props(styles.sectionHead, defaultMarker())}>
            <Icon name="chevron-down" size={12} xstyle={styles.chevron} />
            <span {...props(styles.sectionTitle)}>{group.title}</span>
            <span {...props(styles.count)}>{group.files.length}</span>
            <span {...props(styles.hoverActions)}>
              <button type="button" {...props(styles.textAction)}>
                {group.action} All
              </button>
            </span>
          </div>
          {group.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              trailing={
                <HoverActions>
                  <IconButton icon="refresh" label="Discard changes" />
                  <IconButton
                    icon={staged.has(file.path) ? "minimize" : "plus"}
                    label={group.action}
                  />
                  <button
                    type="button"
                    aria-label={group.action}
                    onClick={() => move(file.path)}
                    {...props(styles.overlayButton)}
                  />
                </HoverActions>
              }
            />
          ))}
        </div>
      ))}
    </>
  );
}

/* 6 */
const SCOPES = ["Uncommitted", "Staged", "Last turn"] as const;

function BranchFirst(): ReactElement {
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("Uncommitted");

  return (
    <>
      <div {...props(styles.header)}>
        <span {...props(styles.branchTitle)}>
          <Icon name="git-branch" size={16} />
          {BRANCH.name}
          <span {...props(styles.ahead)}>↑{BRANCH.ahead}</span>
        </span>
        <HeaderActions />
      </div>
      <div {...props(styles.segmented)} role="tablist">
        {SCOPES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={scope === item}
            onClick={() => setScope(item)}
            {...props(styles.segment, scope === item && styles.segmentOn)}
          >
            {item}
          </button>
        ))}
      </div>
      <CommitBlock />
      <List />
    </>
  );
}

/* 7 */
function Diffstat(): ReactElement {
  const share = TOTAL.added / (TOTAL.added + TOTAL.removed);

  return (
    <>
      <ShippedHeader />
      <div {...props(styles.meter)}>
        <span
          {...props(intent.success, styles.meterPart)}
          style={{ flexGrow: share }}
          aria-hidden
        />
        <span
          {...props(intent.danger, styles.meterPart)}
          style={{ flexGrow: 1 - share }}
          aria-hidden
        />
      </div>
      <CommitBlock />
      <div {...props(styles.list)}>
        {FILES.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            stat={
              <span {...props(styles.statPair)}>
                <span {...props(styles.number)}>{file.added + file.removed}</span>
                <Blocks added={file.added} removed={file.removed} />
              </span>
            }
          />
        ))}
      </div>
    </>
  );
}

/* 8 */
function Tree(): ReactElement {
  return (
    <>
      <ShippedHeader />
      <CommitBlock />
      <div {...props(styles.list)}>
        {byFolder().map((group) => (
          <div key={group.dir}>
            {group.dir !== "" && (
              <div {...props(styles.folder)}>
                <Icon name="folder-open" size={14} />
                <span {...props(styles.folderName)}>{group.dir}</span>
              </div>
            )}
            {group.files.map((file) => (
              <div key={file.path} {...props(group.dir !== "" && styles.indent)}>
                <FileRow
                  file={file}
                  dim={false}
                  trailing={
                    <HoverActions>
                      <IconButton icon="refresh" label="Discard changes" />
                    </HoverActions>
                  }
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/* 9 */
function Collapsed(): ReactElement {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");

  return (
    <>
      <ShippedHeader />
      <div {...props(styles.commit)}>
        {open ? (
          <div {...props(styles.card)}>
            <input
              autoFocus
              value={summary}
              placeholder="Summary"
              onChange={(event) => setSummary(event.target.value)}
              {...props(styles.cardTitle)}
            />
            <textarea placeholder="Description (optional)" rows={3} {...props(styles.cardBody)} />
            <div {...props(styles.cardFoot)}>
              <Button size="sm" icon="sparkle" onClick={() => setSummary(MESSAGE)}>
                Write for me
              </Button>
              <span {...props(styles.spacer)} />
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="solid" disabled={summary.trim() === ""}>
                Commit
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} {...props(styles.ghostCommit)}>
            <Icon name="pencil" size={14} />
            Commit {FILES.length} files…
            <span {...props(styles.kbd)}>⌘↵</span>
          </button>
        )}
      </div>
      <List />
    </>
  );
}

/* 10 */
function CountAware(): ReactElement {
  const { checked, toggle } = useChecks();
  const [message, setMessage] = useState("");
  const reason =
    checked.size === 0 ? "Select files to commit" : message.trim() === "" ? "Add a message" : null;

  return (
    <>
      <ShippedHeader />
      <div {...props(styles.commit)}>
        <MessageField value={message} onChange={setMessage} />
        <PrimaryButton disabled={reason !== null}>
          {reason ?? `Commit ${String(checked.size)} of ${String(FILES.length)} Files and Push`}
        </PrimaryButton>
      </div>
      <div {...props(styles.list)}>
        <div {...props(styles.selectAll)}>
          <span {...props(styles.count)}>
            {checked.size} of {FILES.length} selected
          </span>
          <Checkbox
            aria-label="Select all"
            checked={checked.size === FILES.length}
            indeterminate={checked.size > 0 && checked.size < FILES.length}
            onCheckedChange={() => {
              for (const file of FILES)
                if (checked.has(file.path) === (checked.size === FILES.length)) toggle(file.path);
            }}
          />
        </div>
        {FILES.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            trailing={
              <Checkbox
                aria-label={`Include ${file.path}`}
                checked={checked.has(file.path)}
                onCheckedChange={() => toggle(file.path)}
              />
            }
          />
        ))}
      </div>
    </>
  );
}

/* 11 */
function Compact(): ReactElement {
  const [message, setMessage] = useState(MESSAGE);

  return (
    <>
      <div {...props(styles.compactBar)}>
        <button type="button" {...props(styles.plainTrigger, styles.compactScope)}>
          Uncommitted
          <Icon name="chevron-down" size={12} xstyle={styles.chevron} />
        </button>
        <span {...props(styles.slash)}>/</span>
        <span {...props(styles.compactBranch)}>{BRANCH.name}</span>
        <span {...props(styles.spacer)} />
        <Stat added={TOTAL.added} removed={TOTAL.removed} />
        <IconButton icon="more-horizontal" label="More" />
      </div>
      <div {...props(styles.compactCommit)}>
        <MessageField
          value={message}
          onChange={setMessage}
          trailing={<span {...props(styles.kbd)}>⌘↵</span>}
        />
        <Button size="sm" variant="solid" disabled={message.trim() === ""}>
          Commit
        </Button>
      </div>
      <List dim={false} />
    </>
  );
}

/* 12 */
function Subject(): ReactElement {
  const [summary, setSummary] = useState(MESSAGE);
  const over = summary.length > 50;

  return (
    <>
      <ShippedHeader />
      <div {...props(styles.commit)}>
        <div {...props(styles.card)}>
          <div {...props(styles.subjectRow)}>
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Summary"
              {...props(styles.cardTitle)}
            />
            <span {...props(styles.counter, over && intent.warning, over && styles.counterOver)}>
              {50 - summary.length}
            </span>
          </div>
          <textarea placeholder="Why this change?" rows={2} {...props(styles.cardBody)} />
        </div>
        <PrimaryButton disabled={summary.trim() === ""}>Commit and Push</PrimaryButton>
      </div>
      <List />
    </>
  );
}

const IDEAS: readonly {
  readonly title: string;
  readonly note: string;
  readonly render: () => ReactElement;
}[] = [
  {
    title: "Composer",
    note: "The message and the action share one field, like the chat composer. The full-width grey bar goes away.",
    render: () => <Composer />,
  },
  {
    title: "Docked commit",
    note: "Files come first; the commit bar sits at the bottom of the panel, where the composer sits in chat.",
    render: () => <Docked />,
  },
  {
    title: "Quiet header",
    note: "Scope is plain text, with branch and totals on one line under it. Toolbar icons show on hover.",
    render: () => <QuietHeader />,
  },
  {
    title: "Status letters",
    note: "M, A or D replaces the generic file glyph. Stats go grey and checkboxes appear only on hover or when ticked.",
    render: () => <StatusLetters />,
  },
  {
    title: "Staged and Changes",
    note: "Two collapsible groups instead of checkboxes, so the staged set is visible at a glance.",
    render: () => <Sections />,
  },
  {
    title: "Branch first",
    note: "The branch is the title, with commits ahead. Scope becomes a segmented control instead of a dropdown.",
    render: () => <BranchFirst />,
  },
  {
    title: "Diffstat",
    note: "A red and green bar shows the shape of the change. Rows show one total plus five blocks.",
    render: () => <Diffstat />,
  },
  {
    title: "Folder tree",
    note: "Files grouped under their folder, so long paths stop being truncated and siblings sit together.",
    render: () => <Tree />,
  },
  {
    title: "Collapsed commit",
    note: "One quiet row until you want it. It opens into a summary, a description and a generate button.",
    render: () => <Collapsed />,
  },
  {
    title: "Count-aware button",
    note: "The button says what will happen or why it can't, with a select-all row above the list.",
    render: () => <CountAware />,
  },
  {
    title: "Compact",
    note: "Scope, branch and totals fit on one line. The field is 28px with a small Commit button beside it.",
    render: () => <Compact />,
  },
  {
    title: "Subject and body",
    note: "Git's subject and body as two fields, with a counter that counts down from 50.",
    render: () => <Subject />,
  },
];

export function ChangesPage(): ReactElement {
  return (
    <main {...props(styles.page)}>
      <header {...props(styles.pageHeader)}>
        <h1 {...props(styles.pageTitle)}>Changes tab</h1>
        <p {...props(styles.pageNote)}>
          Twelve takes on the working-tree panel. Same files in each; hover rows and try the
          controls.
        </p>
      </header>
      <div {...props(styles.grid)}>
        {IDEAS.map((idea, index) => (
          <section key={idea.title} {...props(styles.cell)}>
            <div {...props(styles.cellHead)}>
              <span {...props(styles.index)}>{String(index + 1).padStart(2, "0")}</span>
              <h2 {...props(styles.cellTitle)}>{idea.title}</h2>
            </div>
            <p {...props(styles.cellNote)}>{idea.note}</p>
            <div {...props(styles.panel)}>{idea.render()}</div>
          </section>
        ))}
      </div>
    </main>
  );
}

const styles = create({
  page: {
    minHeight: "100vh",
    paddingBlock: "48px 120px",
    paddingInline: 40,
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  pageHeader: { display: "flex", flexDirection: "column", gap: 4, marginBlockEnd: 32 },
  pageTitle: { margin: 0, fontSize: type.fontLg, fontWeight: 600, lineHeight: type.leadingLg },
  pageNote: { margin: 0, color: role.contentSecondary },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
    gap: 32,
    alignItems: "start",
  },
  cell: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  cellHead: { display: "flex", alignItems: "baseline", gap: 8 },
  index: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  cellTitle: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  cellNote: {
    margin: 0,
    minHeight: 40,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    height: 460,
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderPrimary}`,
  },

  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 8,
    paddingInline: 8,
    flexShrink: 0,
  },
  actions: { display: "inline-flex", alignItems: "center", gap: 2, marginInlineStart: "auto" },
  scopeChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingInline: 8,
    border: "none",
    borderRadius: radius.pill,
    backgroundColor: { default: role.bgMuted, ":hover": role.bgControlHover },
    color: role.contentPrimary,
    font: "inherit",
    cursor: "pointer",
  },
  scopeLabel: { fontWeight: 500 },
  chevron: { color: role.contentTertiary },
  branch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  stat: {
    display: "inline-flex",
    gap: 6,
    flexShrink: 0,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  tone: { color: role.contentSecondary },
  quiet: { color: role.contentTertiary },

  commit: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingInline: 8,
    paddingBlockEnd: 8,
    flexShrink: 0,
    borderBlockEnd: `1px solid ${role.borderSecondary}`,
  },
  field: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingInline: "10px 4px",
    borderRadius: radius.md,
    backgroundColor: role.bgElevated,
    boxShadow: {
      default: `inset 0 0 0 1px ${role.borderControl}`,
      ":focus-within": `inset 0 0 0 1px ${role.borderInteractivePrimary}`,
    },
    cursor: "text",
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingBlock: 6,
    border: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    font: "inherit",
    "::placeholder": { color: role.contentTertiary },
  },
  split: { display: "flex", gap: 1 },
  primary: {
    height: 30,
    border: "none",
    backgroundColor: {
      default: role.buttonFill,
      ":hover:not(:disabled)": role.buttonFillHover,
      ":disabled": role.bgMuted,
    },
    color: { default: role.contentOnInteractiveStrong, ":disabled": role.contentDisabled },
    font: "inherit",
    fontWeight: 500,
    cursor: { default: "pointer", ":disabled": "default" },
  },
  primaryMain: {
    flex: 1,
    borderStartStartRadius: radius.md,
    borderEndStartRadius: radius.md,
  },
  primaryMenu: {
    display: "grid",
    placeItems: "center",
    width: 32,
    borderStartEndRadius: radius.md,
    borderEndEndRadius: radius.md,
  },

  inlineActions: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  inlineMenu: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    height: 24,
    paddingInline: 6,
    border: "none",
    borderRadius: radius.sm,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    font: "inherit",
    fontSize: type.fontSm,
    cursor: "pointer",
  },
  send: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    border: "none",
    borderRadius: radius.pill,
    backgroundColor: role.bgMuted,
    color: role.contentDisabled,
  },
  sendReady: {
    backgroundColor: { default: role.buttonFill, ":hover": role.buttonFillHover },
    color: role.contentOnInteractiveStrong,
    cursor: "pointer",
  },

  list: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 4,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 30,
    paddingInline: "6px 4px",
    borderRadius: radius.sm,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    position: "relative",
  },
  leading: { display: "grid", placeItems: "center", width: 16, flexShrink: 0 },
  fileIcon: { color: role.contentTertiary },
  name: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  base: { flexShrink: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" },
  dir: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    direction: "rtl",
    textAlign: "start",
    color: role.contentTertiary,
    fontSize: type.fontSm,
  },
  hoverActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    position: "relative",
    opacity: { default: 0, [hover]: 1 },
  },
  revealCheck: { display: "inline-flex" },
  revealOnHover: { opacity: { default: 0, [hover]: 1 } },
  overlayButton: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 0,
    width: 28,
    padding: 0,
    border: "none",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  letter: {
    width: 16,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontWeight: 600,
    textAlign: "center",
  },

  dock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    flexShrink: 0,
    borderBlockStart: `1px solid ${role.borderSecondary}`,
    backgroundColor: role.bgChrome,
  },

  quietHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBlock: "10px 10px",
    paddingInline: 12,
    flexShrink: 0,
  },
  quietTitle: { display: "flex", alignItems: "center", height: 28 },
  plainTrigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: 0,
    border: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  },
  subline: {
    display: "flex",
    gap: 4,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    whiteSpace: "nowrap",
  },

  section: { display: "flex", flexDirection: "column", paddingInline: 4, paddingBlockStart: 4 },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingInline: 8,
  },
  sectionTitle: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: 600,
  },
  count: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  textAction: {
    padding: 0,
    border: "none",
    backgroundColor: "transparent",
    color: role.contentInteractivePrimary,
    font: "inherit",
    fontSize: type.fontSm,
    cursor: "pointer",
  },

  branchTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    paddingInline: 4,
    fontWeight: 600,
  },
  ahead: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  segmented: {
    display: "flex",
    gap: 2,
    padding: 2,
    marginInline: 8,
    marginBlockEnd: 8,
    borderRadius: radius.md,
    backgroundColor: role.bgMuted,
  },
  segment: {
    flex: 1,
    height: 26,
    border: "none",
    borderRadius: radius.sm,
    backgroundColor: "transparent",
    color: role.contentSecondary,
    font: "inherit",
    fontSize: type.fontSm,
    cursor: "pointer",
  },
  segmentOn: {
    backgroundColor: role.bgElevated,
    boxShadow: role.borderPrimary === "" ? "none" : `0 0 0 1px ${role.borderPrimary}`,
    color: role.contentPrimary,
    fontWeight: 500,
  },

  meter: {
    display: "flex",
    gap: 2,
    height: 4,
    marginInline: 12,
    marginBlockEnd: 10,
    flexShrink: 0,
  },
  meterPart: {
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  },
  statPair: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 },
  number: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  blocks: { display: "inline-flex", gap: 1 },
  block: { width: 6, height: 6, borderRadius: 1 },
  blockOn: { backgroundColor: role.contentSecondary },
  blockOff: { backgroundColor: role.bgMuted },

  folder: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingInline: 6,
    color: role.contentTertiary,
    fontSize: type.fontSm,
  },
  folderName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  indent: { paddingInlineStart: 14 },

  ghostCommit: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    paddingInline: 10,
    border: "none",
    borderRadius: radius.md,
    backgroundColor: { default: role.bgMuted, ":hover": role.bgControlHover },
    color: role.contentSecondary,
    font: "inherit",
    cursor: "pointer",
  },
  kbd: {
    marginInlineStart: "auto",
    paddingInline: 4,
    color: role.contentTertiary,
    fontSize: type.fontXs,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    backgroundColor: role.bgElevated,
    boxShadow: {
      default: `inset 0 0 0 1px ${role.borderControl}`,
      ":focus-within": `inset 0 0 0 1px ${role.borderInteractivePrimary}`,
    },
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 10,
    border: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    font: "inherit",
    fontWeight: 500,
    "::placeholder": { color: role.contentTertiary },
  },
  cardBody: {
    paddingBlock: "0 8px",
    paddingInline: 10,
    border: "none",
    outline: "none",
    resize: "none",
    backgroundColor: "transparent",
    color: role.contentSecondary,
    font: "inherit",
    fontSize: type.fontSm,
    "::placeholder": { color: role.contentTertiary },
  },
  cardFoot: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 4,
    borderBlockStart: `1px solid ${role.borderSecondary}`,
  },
  spacer: { flex: 1 },

  selectAll: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 28,
    paddingInline: "6px 4px",
  },

  compactBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingInline: "12px 6px",
    flexShrink: 0,
  },
  compactScope: { fontWeight: 500 },
  slash: { color: role.contentDisabled },
  compactBranch: {
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  compactCommit: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: 6,
    paddingInline: 8,
    paddingBlockEnd: 8,
    flexShrink: 0,
    borderBlockEnd: `1px solid ${role.borderSecondary}`,
  },

  subjectRow: { display: "flex", alignItems: "center", paddingInlineEnd: 10 },
  counter: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  counterOver: { color: role.contentSecondary },
});
