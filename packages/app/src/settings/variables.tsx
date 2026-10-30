import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, Textarea } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { Toggle } from "@nyte-ai/ui/toggle";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ClipboardEvent, FormEvent, ReactElement } from "react";
import { Type } from "typebox";
import type { Static } from "typebox";
import { errorMessage } from "../errors.ts";
import { useSetting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { useWorkspaces } from "../queries.ts";
import { connected } from "../sdk.tsx";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { parseEnv } from "./dotenv.ts";
import { SettingsSection } from "./rows.tsx";

/** The `variables` built-in's setting: keys are `NAME` or `<workspace id>/NAME`. */
const ID = "variables.entries";

const EntriesType = Type.Record(
  Type.String(),
  Type.Object({ secret: Type.Boolean(), value: Type.Optional(Type.String()) }),
);

type Entries = Static<typeof EntriesType>;

const entriesSetting = pluginSetting(ID, EntriesType);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PAT)$/i;

const ROW_MARK = { "data-settings-row": "" } as const;

interface Variable {
  readonly key: string;
  readonly name: string;
  readonly folder: string | null;
  readonly secret: boolean;
  readonly value: string;
}

interface Folder {
  readonly id: string;
  readonly name: string;
}

interface Pair {
  readonly key: number;
  readonly name: string;
  readonly value: string;
  /** Null until the user chooses; until then the name decides. */
  readonly secret: boolean | null;
}

interface Issues {
  readonly name: string | undefined;
  readonly value: string | undefined;
}

type Editing =
  | { readonly kind: "new" }
  | { readonly kind: "variable"; readonly key: string }
  | null;

export function VariablesSettings(): ReactElement {
  const entries = useSetting(entriesSetting);
  const [editing, setEditing] = useState<Editing>(null);

  const folders: readonly Folder[] = (useWorkspaces().data ?? []).flatMap((workspace) =>
    workspace.worktree === null ? [{ id: workspace.id, name: workspace.name }] : [],
  );

  const save = useMutation({
    mutationFn: async (next: Entries) => {
      const outcome = await (await connected()).settings.apply(ID, next);

      if (outcome.kind !== "applied") throw new Error("Those variables aren't valid.");
    },
    onSuccess: () => setEditing(null),
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const variables = readVariables(entries ?? {});

  const folderName = (folder: string | null): string =>
    folder === null
      ? "Every folder"
      : (folders.find((known) => known.id === folder)?.name ?? "Removed folder");

  const editor = (variable: Variable | null) => (
    <VariableEditor
      key={variable?.key ?? "new"}
      entries={entries ?? {}}
      variable={variable}
      folders={folders}
      folderName={folderName}
      saving={save.isPending}
      onCancel={() => setEditing(null)}
      onSave={(next) => save.mutate(next)}
    />
  );

  return (
    <SettingsSection description="Commands and terminals start with these. A folder's own value replaces one set for every folder">
      {variables.map((variable) =>
        editing?.kind === "variable" && editing.key === variable.key ? (
          editor(variable)
        ) : (
          <VariableRow
            key={variable.key}
            variable={variable}
            folder={folderName(variable.folder)}
            busy={editing !== null || save.isPending}
            onEdit={() => setEditing({ kind: "variable", key: variable.key })}
            onRemove={() =>
              save.mutate(
                Object.fromEntries(
                  Object.entries(entries ?? {}).filter((entry) => entry[0] !== variable.key),
                ),
              )
            }
          />
        ),
      )}
      {editing?.kind === "new" ? (
        editor(null)
      ) : (
        <div {...ROW_MARK} {...props(settingsPatterns.rowRule, styles.addRow)}>
          <Button
            icon="plus"
            disabled={entries === undefined || editing !== null}
            onClick={() => setEditing({ kind: "new" })}
          >
            Add Variable
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function readVariables(entries: Entries): readonly Variable[] {
  return Object.entries(entries)
    .map((entry): Variable => {
      const slash = entry[0].indexOf("/");

      return {
        key: entry[0],
        name: slash === -1 ? entry[0] : entry[0].slice(slash + 1),
        folder: slash === -1 ? null : entry[0].slice(0, slash),
        secret: entry[1].secret,
        value: entry[1].value ?? "",
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

function VariableRow({
  variable,
  folder,
  busy,
  onEdit,
  onRemove,
}: {
  readonly variable: Variable;
  readonly folder: string;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}): ReactElement {
  return (
    <div {...ROW_MARK} {...props(settingsPatterns.rowRule, styles.variable)}>
      <span {...props(styles.name)}>
        {variable.secret && (
          <span {...props(styles.lock)}>
            <Icon name="lock" size={12} />
          </span>
        )}
        <span {...props(styles.truncate)}>{variable.name}</span>
      </span>
      <span {...props(styles.value, !variable.secret && styles.code)}>
        {variable.secret ? "Secret" : variable.value}
      </span>
      <span {...props(styles.folder)}>{folder}</span>
      <span {...props(styles.actions)}>
        <Button
          iconOnly
          icon="pencil"
          aria-label={`Edit ${variable.name}`}
          disabled={busy}
          onClick={onEdit}
        />
        <Button
          iconOnly
          icon="trash"
          aria-label={`Remove ${variable.name}`}
          disabled={busy}
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

/**
 * Bands like Vercel's form: the folder, then key and value pairs, then the actions. A new
 * entry takes several pairs, so a pasted `.env` file becomes one row per line; a blank extra
 * row is ignored. Each pair starts secret when its name looks like a key or token.
 */
function VariableEditor({
  entries,
  variable,
  folders,
  folderName,
  saving,
  onCancel,
  onSave,
}: {
  readonly entries: Entries;
  readonly variable: Variable | null;
  readonly folders: readonly Folder[];
  readonly folderName: (folder: string | null) => string;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSave: (next: Entries) => void;
}): ReactElement {
  const single = variable !== null;
  const [folder, setFolder] = useState(variable?.folder ?? null);
  const [submitted, setSubmitted] = useState(false);
  const [nextKey, setNextKey] = useState(1);

  const [pairs, setPairs] = useState<readonly Pair[]>([
    {
      key: 0,
      name: variable?.name ?? "",
      value: variable?.value ?? "",
      secret: variable?.secret ?? null,
    },
  ]);

  const options = [
    { value: "", label: "Every folder" },
    ...folders.map((known) => ({ value: known.id, label: known.name })),
  ];

  const rows = pairs.map((pair, index) => ({
    pair,
    blank: !single && index > 0 && pair.name === "" && pair.value === "",
    issues: pairIssues(pair, {
      entries,
      variable,
      folder,
      folderName,
      earlier: pairs.slice(0, index).map((other) => other.name),
    }),
  }));

  const kept = rows.filter((row) => !row.blank);

  const paste = (index: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    const assignments = parseEnv(event.clipboardData.getData("text"));
    const first = assignments[0];

    if (first === undefined) return;

    event.preventDefault();

    const inserted = (single ? [first] : assignments).map((assignment, offset): Pair => ({
      key: offset === 0 ? (pairs[index]?.key ?? nextKey) : nextKey + offset,
      name: assignment.name,
      value: assignment.value,
      secret: offset === 0 ? (pairs[index]?.secret ?? null) : null,
    }));

    setPairs([...pairs.slice(0, index), ...inserted, ...pairs.slice(index + 1)]);
    setNextKey(nextKey + inserted.length);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitted(true);

    if (kept.some((row) => row.issues.name !== undefined || row.issues.value !== undefined)) return;

    onSave(
      Object.fromEntries([
        ...Object.entries(entries).filter((entry) => entry[0] !== variable?.key),
        ...kept.map((row) => [
          keyFor(folder, row.pair.name),
          secretPair(row.pair)
            ? row.pair.value === ""
              ? { secret: true }
              : { secret: true, value: row.pair.value }
            : { secret: false, value: row.pair.value },
        ]),
      ]),
    );
  };

  return (
    <form
      {...ROW_MARK}
      aria-label={single ? `Edit ${variable.name}` : "New variables"}
      onSubmit={submit}
      {...props(settingsPatterns.rowRule, styles.editor)}
    >
      <div {...props(styles.band)}>
        <span {...props(text.base, styles.bandTitle)}>Folder</span>
        <Select
          items={options}
          value={folder ?? ""}
          onValueChange={(next) => {
            if (next !== null) setFolder(next === "" ? null : next);
          }}
        >
          <SelectTrigger aria-label="Folder" width="wide">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div {...props(styles.band, styles.pairs)}>
        <div {...props(styles.grid, !single && styles.gridRemovable)}>
          <span {...props(text.sm, styles.label)}>Key</span>
          <span {...props(text.sm, styles.label)}>Value</span>
          <span />
          {!single && <span />}
          {rows.map((row, index) => (
            <PairRow
              key={row.pair.key}
              pair={row.pair}
              nameIssue={
                row.blank || (!submitted && row.pair.name === "") ? undefined : row.issues.name
              }
              valueIssue={submitted && !row.blank ? row.issues.value : undefined}
              first={index === 0}
              keepsSecret={variable?.secret === true && secretPair(row.pair)}
              onRemove={
                single || pairs.length === 1
                  ? null
                  : () => setPairs(pairs.filter((other) => other.key !== row.pair.key))
              }
              removable={!single}
              onPaste={paste(index)}
              onChange={(next) =>
                setPairs(pairs.map((other) => (other.key === row.pair.key ? next : other)))
              }
            />
          ))}
        </div>
        {!single && (
          <span {...props(styles.addAnother)}>
            <Button
              icon="plus"
              onClick={() => {
                setPairs([...pairs, { key: nextKey, name: "", value: "", secret: null }]);
                setNextKey(nextKey + 1);
              }}
            >
              Add Another
            </Button>
          </span>
        )}
      </div>

      <div {...props(styles.band, styles.footer)}>
        <span {...props(text.sm, styles.hint)}>
          {single
            ? "Paste KEY=value into Key to fill both"
            : "Paste a .env file into Key to add every line"}
        </span>
        <span {...props(styles.footerActions)}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="solid" type="submit" loading={saving}>
            {single
              ? "Save"
              : kept.length > 1
                ? `Add ${String(kept.length)} Variables`
                : "Add Variable"}
          </Button>
        </span>
      </div>
    </form>
  );
}

/** One key, value, secret toggle and remove button on the editor's grid, issues below. */
function PairRow({
  pair,
  nameIssue,
  valueIssue,
  first,
  keepsSecret,
  removable,
  onRemove,
  onPaste,
  onChange,
}: {
  readonly pair: Pair;
  readonly nameIssue: string | undefined;
  readonly valueIssue: string | undefined;
  readonly first: boolean;
  readonly keepsSecret: boolean;
  readonly removable: boolean;
  readonly onRemove: (() => void) | null;
  readonly onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  readonly onChange: (pair: Pair) => void;
}): ReactElement {
  return (
    <>
      <Input
        autoFocus={first}
        aria-label="Key"
        value={pair.name}
        placeholder={first ? "e.g. API_KEY" : undefined}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={nameIssue !== undefined}
        xstyle={styles.code}
        onPaste={onPaste}
        onValueChange={(name) => onChange({ ...pair, name })}
      />
      {pair.value.includes("\n") ? (
        <span {...props(styles.multiline, secretPair(pair) && styles.masked)}>
          <Textarea
            aria-label="Value"
            value={pair.value}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={valueIssue !== undefined}
            xstyle={styles.code}
            onChange={(event) => onChange({ ...pair, value: event.target.value })}
          />
        </span>
      ) : (
        <Input
          aria-label="Value"
          type={secretPair(pair) ? "password" : "text"}
          value={pair.value}
          placeholder={keepsSecret ? "Leave empty to keep it" : undefined}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={valueIssue !== undefined}
          xstyle={styles.code}
          onValueChange={(value) => onChange({ ...pair, value })}
        />
      )}
      <Toggle
        iconOnly
        icon="lock"
        aria-label="Secret"
        pressed={secretPair(pair)}
        onPressedChange={(secret) => onChange({ ...pair, secret })}
      />
      {removable && (
        <Button
          iconOnly
          icon="trash"
          aria-label={pair.name === "" ? "Remove This Row" : `Remove ${pair.name}`}
          disabled={onRemove === null}
          onClick={onRemove ?? undefined}
        />
      )}
      {(nameIssue !== undefined || valueIssue !== undefined) && (
        <>
          <Issue text={nameIssue} />
          <Issue text={valueIssue} />
          <span />
          {removable && <span />}
        </>
      )}
    </>
  );
}

function Issue({ text: message }: { readonly text: string | undefined }): ReactElement {
  return <span {...props(intent.danger, text.sm, styles.issue)}>{message}</span>;
}

function pairIssues(
  pair: Pair,
  context: {
    readonly entries: Entries;
    readonly variable: Variable | null;
    readonly folder: string | null;
    readonly folderName: (folder: string | null) => string;
    readonly earlier: readonly string[];
  },
): Issues {
  const key = keyFor(context.folder, pair.name);
  const sameKey = context.variable?.key === key;

  const name =
    pair.name === ""
      ? "Enter a name"
      : !NAME.test(pair.name)
        ? "Use letters, digits, and _, not starting with a digit"
        : context.earlier.includes(pair.name)
          ? `${pair.name} is here twice`
          : !sameKey && Object.hasOwn(context.entries, key)
            ? `${pair.name} is already set for ${context.folderName(context.folder)}`
            : undefined;

  const value =
    pair.value !== ""
      ? undefined
      : secretPair(pair)
        ? context.variable?.secret === true && sameKey
          ? undefined
          : "Enter a value"
        : context.variable?.secret === true
          ? "Enter the value again"
          : undefined;

  return { name, value };
}

function keyFor(folder: string | null, name: string): string {
  return folder === null ? name : `${folder}/${name}`;
}

/** A pair is secret when the user said so, or until then when its name looks like a key. */
function secretPair(pair: Pair): boolean {
  return pair.secret ?? SECRET_NAME.test(pair.name);
}

const NARROW = "@container (max-width: 500px)";

const styles = create({
  /**
   * Name over value on the left, folder and actions on the right. Narrow widths move the
   * folder under the value instead of stacking the actions below.
   */
  variable: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr) auto auto", [NARROW]: "minmax(0, 1fr) auto" },
    gridTemplateAreas: {
      default: '"name folder actions" "value folder actions"',
      [NARROW]: '"name actions" "value actions" "folder actions"',
    },
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s0_5,
    padding: settings.rowPadding,
  },
  name: {
    gridArea: "name",
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingBase,
  },
  value: {
    gridArea: "value",
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  folder: {
    gridArea: "folder",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
  },
  actions: { gridArea: "actions", display: "flex", gap: space.s1 },
  lock: { display: "inline-flex", flexShrink: 0, color: role.contentSecondary },
  truncate: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  /** Code at the code size, on the line box of the text beside it. */
  code: { fontFamily: type.fontMono, fontSize: type.fontCode },
  multiline: { display: "flex", flexDirection: "column", minWidth: 0 },
  /** A multi-line secret can't be a password input; Chromium masks it the same way. Inherited. */
  masked: { WebkitTextSecurity: "disc" },
  addRow: {
    display: "flex",
    paddingBlock: space.s2,
    paddingInline: `calc(${settings.rowPaddingInline} - ${space.s2})`,
  },
  editor: { display: "flex", flexDirection: "column", backgroundColor: role.bgElevated },
  /** One band of the editor, a hairline above every band but the first. */
  band: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    padding: settings.rowPadding,
    borderBlockStartWidth: { default: 1, ":first-child": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
  },
  bandTitle: { color: role.contentPrimary },
  pairs: { flexDirection: "column", alignItems: "stretch" },
  /** Key, value, secret, and remove share columns, so every row lines up with the labels. */
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr)) auto",
    alignItems: "start",
    columnGap: space.s2,
    rowGap: space.s2,
  },
  gridRemovable: { gridTemplateColumns: "repeat(2, minmax(0, 1fr)) auto auto" },
  label: { color: role.contentSecondary },
  issue: { color: role.contentInteractivePrimary },
  addAnother: { display: "flex", marginInlineStart: `calc(-1 * ${space.s2})` },
  footer: { backgroundColor: role.bgMutedTranslucent },
  hint: { color: role.contentSecondary },
  footerActions: { display: "flex", gap: space.s2, marginInlineStart: "auto" },
});
