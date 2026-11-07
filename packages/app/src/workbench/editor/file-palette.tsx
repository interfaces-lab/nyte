import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Command } from "@nyte-ai/ui/command";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { FileTypeIcon, FileTypeIconSprite } from "@nyte-ai/ui/file-type-icon";
import { Loader } from "@nyte-ai/ui/loader";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import type { MentionFile } from "../../data/files.ts";
import { fuzzyScore } from "../../lib/fuzzy-match.ts";
import { mentionsFolder } from "../../references/message-references.ts";
import type { OutlineSymbol } from "./outline.ts";
import { SymbolKindGlyph } from "./symbol-kind.tsx";

const MATCH_LIMIT = 50;

type Mode =
  | { readonly kind: "files"; readonly needle: string }
  | {
      readonly kind: "line";
      readonly line: number | undefined;
      readonly column: number | undefined;
    }
  | { readonly kind: "symbol"; readonly needle: string };

type PaletteTarget =
  | { readonly kind: "file"; readonly file: MentionFile }
  | { readonly kind: "symbol"; readonly symbol: OutlineSymbol }
  | { readonly kind: "line" };

interface Row {
  readonly target: PaletteTarget;
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly run: () => void;
}

export interface PaletteFile {
  readonly path: string;
  readonly lines: number;
  readonly symbols: readonly OutlineSymbol[];
}

export function FilePalette({
  query,
  files,
  recent,
  filesError,
  onRetryFiles,
  active,
  onQueryChange,
  onClose,
  onOpenFile,
  onGoTo,
}: {
  readonly query: string | undefined;
  readonly files: readonly MentionFile[] | undefined;
  readonly recent: readonly MentionFile[];
  readonly filesError: Error | null;
  readonly onRetryFiles: () => void;
  readonly active: PaletteFile | undefined;
  readonly onQueryChange: (query: string) => void;
  readonly onClose: () => void;
  readonly onOpenFile: (file: MentionFile) => void;
  readonly onGoTo: (line: number, column: number | undefined) => void;
}): ReactElement {
  const mode = paletteMode(query ?? "");

  const run = (action: () => void): void => {
    onClose();
    action();
  };

  const rows = paletteRows(mode, { files, recent, active, onOpenFile, onGoTo });
  const recentPaths = new Set(recent.map((file) => file.path));

  const groups =
    mode.kind === "files" && mode.needle === ""
      ? [
          { heading: "Recent", rows: rows.filter((row) => recentPaths.has(row.key)) },
          { heading: "All files", rows: rows.filter((row) => !recentPaths.has(row.key)) },
        ]
      : [{ heading: undefined, rows }];

  return (
    <Command.Root
      open={query !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Command.Popup
        title="Go to file"
        items={rows.map((row) => row.key)}
        value={query ?? ""}
        onValueChange={onQueryChange}
      >
        <FileTypeIconSprite />
        <Command.Input
          aria-label="Go to file"
          placeholder="Go to file, :line or @symbol"
          onKeyDown={(event) => {
            const input = event.currentTarget;

            if (event.key.length === 1 && input.selectionEnd === 0 && /^[:@]$/u.test(input.value))
              input.setSelectionRange(1, 1);
          }}
        />
        <div role="status" {...props(srOnly)}>
          {`${String(rows.length)} ${rows.length === 1 ? "result" : "results"}`}
        </div>
        <Command.List aria-label={mode.kind === "symbol" ? "Symbols" : "Files"}>
          <Command.Empty>
            {mode.kind === "files" && filesError !== null ? (
              <div>
                <p>Could not load files.</p>
                <Button onClick={onRetryFiles}>Retry</Button>
              </div>
            ) : mode.kind === "files" && files === undefined ? (
              <div>
                <Loader />
                <p>Loading files…</p>
              </div>
            ) : (
              <div>
                <p>{emptyMessage(mode, active)}</p>
                {mode.kind === "files" && mode.needle !== "" && (
                  <Button onClick={() => onQueryChange("")}>Clear Search</Button>
                )}
              </div>
            )}
          </Command.Empty>
          {groups
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <Command.Group key={group.heading ?? "matches"} heading={group.heading}>
                {group.rows.map((row) => (
                  <Command.Item
                    key={row.key}
                    value={row.key}
                    leading={
                      row.target.kind === "file" ? (
                        <FileTypeIcon path={row.target.file.displayPath} />
                      ) : row.target.kind === "symbol" ? (
                        <SymbolKindGlyph kind={row.target.symbol.kind} />
                      ) : (
                        <Icon name="chevron-right" size="md" />
                      )
                    }
                    meta={row.detail}
                    onClick={() => run(row.run)}
                  >
                    {row.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
        </Command.List>
      </Command.Popup>
    </Command.Root>
  );
}

function paletteMode(query: string): Mode {
  if (query.startsWith(":")) {
    const match = /^:\s*(\d+)?(?:[:,]\s*(\d+))?/u.exec(query);

    return {
      kind: "line",
      line: match?.[1] === undefined ? undefined : Number(match[1]),
      column: match?.[2] === undefined ? undefined : Number(match[2]),
    };
  }

  if (query.startsWith("@"))
    return { kind: "symbol", needle: query.slice(1).trim().toLocaleLowerCase() };

  return { kind: "files", needle: query.trim().toLocaleLowerCase() };
}

function paletteRows(
  mode: Mode,
  input: {
    readonly files: readonly MentionFile[] | undefined;
    readonly recent: readonly MentionFile[];
    readonly active: PaletteFile | undefined;
    readonly onOpenFile: (file: MentionFile) => void;
    readonly onGoTo: (line: number, column: number | undefined) => void;
  },
): readonly Row[] {
  switch (mode.kind) {
    case "files": {
      const indexed = (input.files ?? []).filter((file) => !mentionsFolder(file));
      const recentPaths = new Set(input.recent.map((file) => file.path));

      const matches =
        mode.needle === ""
          ? [
              ...input.recent.filter((file) => !mentionsFolder(file)),
              ...indexed
                .filter((file) => !recentPaths.has(file.path))
                .sort((left, right) => left.displayPath.localeCompare(right.displayPath)),
            ]
          : indexed
              .flatMap((file) => {
                const name = file.displayPath.slice(file.displayPath.lastIndexOf("/") + 1);
                const filename = fuzzyScore(name, mode.needle);
                const score = filename ?? fuzzyScore(file.displayPath, mode.needle);

                return score === undefined
                  ? []
                  : [{ file, score, filename: filename !== undefined }];
              })
              .sort(
                (left, right) =>
                  Number(right.filename) - Number(left.filename) || right.score - left.score,
              )
              .slice(0, MATCH_LIMIT)
              .map((match) => match.file);

      return matches.map((file) => {
        const slash = file.displayPath.lastIndexOf("/");

        return {
          target: { kind: "file", file },
          key: file.path,
          label: file.displayPath.slice(slash + 1),
          detail: slash > 0 ? file.displayPath.slice(0, slash) : undefined,
          run: () => input.onOpenFile(file),
        };
      });
    }

    case "line": {
      const active = input.active;
      const line = mode.line;

      if (active === undefined || line === undefined) return [];
      const target = Math.min(Math.max(line, 1), active.lines);

      return [
        {
          target: { kind: "line" },
          key: `line:${String(target)}`,
          label:
            mode.column === undefined
              ? `Go to line ${String(target)}`
              : `Go to line ${String(target)}, column ${String(mode.column)}`,
          run: () => input.onGoTo(target, mode.column),
        },
      ];
    }

    case "symbol":
      return (input.active?.symbols ?? [])
        .flatMap((symbol) => {
          const score = fuzzyScore(symbol.name, mode.needle);

          return score === undefined ? [] : [{ symbol, score }];
        })
        .sort((left, right) => right.score - left.score)
        .map((match) => ({
          target: { kind: "symbol", symbol: match.symbol },
          key: `symbol:${String(match.symbol.line)}:${match.symbol.name}`,
          label: match.symbol.name,
          detail: `${match.symbol.kind} \u00b7 line ${String(match.symbol.line)}`,
          run: () => input.onGoTo(match.symbol.line, undefined),
        }));
    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
}

function emptyMessage(mode: Mode, active: PaletteFile | undefined): string {
  switch (mode.kind) {
    case "files":
      return mode.needle === "" ? "No files in this folder" : `No files match "${mode.needle}"`;
    case "line":
      return active === undefined
        ? "Open a file to go to a line"
        : `Type a line number from 1 to ${String(active.lines)}`;
    case "symbol":
      if (active === undefined) return "Open a file to go to a symbol";

      return active.symbols.length === 0 ? "No symbols in this file" : "No symbols match";
    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
}
