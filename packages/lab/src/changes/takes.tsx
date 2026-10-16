/** Twelve takes on the working-tree panel, each drawn from the shared parts. */
import { defaultMarker, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Icon } from "@nyte-ai/ui/icon";
import { intent } from "@nyte-ai/ui/surface-theme";
import { BRANCH, FILES, MESSAGE, TOTAL, byFolder } from "./fixtures";
import { styles } from "./page.stylex";
import {
  Blocks,
  CommitBlock,
  FileRow,
  HeaderActions,
  HoverActions,
  IconButton,
  List,
  MessageField,
  PrimaryButton,
  ShippedHeader,
  Stat,
  StatusLetter,
  useChecks,
} from "./parts";

export function Composer(): ReactElement {
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

export function Docked(): ReactElement {
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

export function QuietHeader(): ReactElement {
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

export function StatusLetters(): ReactElement {
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
                {...props(styles.revealCheck, checked.has(file.path) ? null : styles.revealOnHover)}
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

export function Sections(): ReactElement {
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
                  <Button
                    size="sm"
                    iconOnly
                    icon={staged.has(file.path) ? "minimize" : "plus"}
                    aria-label={group.action}
                    onClick={() => move(file.path)}
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

const SCOPES = ["Uncommitted", "Staged", "Last turn"] as const;

export function BranchFirst(): ReactElement {
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

export function Diffstat(): ReactElement {
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

export function Tree(): ReactElement {
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

export function Collapsed(): ReactElement {
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

export function CountAware(): ReactElement {
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

export function Compact(): ReactElement {
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

export function Subject(): ReactElement {
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
