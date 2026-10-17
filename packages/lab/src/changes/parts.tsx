/** The building blocks every take on the Changes tab shares: rows, headers, and commit controls. */
import { defaultMarker, props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { intent } from "@nyte-ai/ui/surface-theme";
import {
  BRANCH,
  FILES,
  MESSAGE,
  TOTAL,
  splitPath,
  type ChangedFile,
  type FileStatus,
} from "./fixtures";
import { styles } from "./page.stylex";

export function Stat({
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

export function IconButton({
  icon,
  label,
}: {
  readonly icon: IconName;
  readonly label: string;
}): ReactElement {
  return <Button size="sm" icon={icon} iconOnly aria-label={label} />;
}

export function HeaderActions(): ReactElement {
  return (
    <span {...props(styles.actions)}>
      <IconButton icon="refresh" label="Refresh" />
      <IconButton icon="more-horizontal" label="More" />
      <IconButton icon="panel-right" label="Hide panel" />
    </span>
  );
}

function FileName({
  path,
  dim = true,
}: {
  readonly path: string;
  readonly dim?: boolean;
}): ReactElement {
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

export function StatusLetter({ status }: { readonly status: FileStatus }): ReactElement {
  return (
    <span {...props(STATUS_INTENT[status], styles.letter)} aria-label={status}>
      {STATUS_LETTER[status]}
    </span>
  );
}

export function Blocks({
  added,
  removed,
}: {
  readonly added: number;
  readonly removed: number;
}): ReactElement {
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

export function FileRow({
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

export function HoverActions({ children }: { readonly children: ReactNode }): ReactElement {
  return <span {...props(styles.hoverActions)}>{children}</span>;
}

export function useChecks(): {
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

export function ShippedHeader(): ReactElement {
  return (
    <div {...props(styles.header)}>
      <ScopeChip />
      <BranchLabel />
      <HeaderActions />
    </div>
  );
}

export function MessageField({
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

export function PrimaryButton({
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

export function List({ dim = true }: { readonly dim?: boolean }): ReactElement {
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

export function CommitBlock({
  label = "Commit and Push",
}: {
  readonly label?: string;
}): ReactElement {
  const [message, setMessage] = useState(MESSAGE);

  return (
    <div {...props(styles.commit)}>
      <MessageField value={message} onChange={setMessage} />
      <PrimaryButton disabled={message.trim() === ""}>{label}</PrimaryButton>
    </div>
  );
}
