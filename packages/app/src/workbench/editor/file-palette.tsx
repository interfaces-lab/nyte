import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Command } from "@nyte-ai/ui/command";
import { Icon } from "@nyte-ai/ui/icon";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import type { MentionFile } from "../../data/files.ts";
import { createFileRanking } from "../../lib/file-ranking.ts";
import { mentionsFolder } from "../../references/message-references.ts";
import type { OutlineSymbol } from "./outline.ts";

const MATCH_LIMIT = 50;

type Mode =
  | { readonly kind: "files"; readonly needle: string }
  | {
      readonly kind: "line";
      readonly line: number | undefined;
      readonly column: number | undefined;
    }
  | { readonly kind: "symbol"; readonly needle: string };

interface Row {
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
  active,
  onQueryChange,
  onClose,
  onOpenFile,
  onGoTo,
}: {
  readonly query: string | undefined;
  readonly files: readonly MentionFile[] | undefined;
  readonly recent: readonly MentionFile[];
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
          <Command.Empty>{emptyMessage(mode, active)}</Command.Empty>
          {rows.map((row) => (
            <Command.Item
              key={row.key}
              value={row.key}
              leading={<Icon name={mode.kind === "files" ? "file" : "chevron-right"} size="md" />}
              meta={row.detail}
              onClick={() => run(row.run)}
            >
              {row.label}
            </Command.Item>
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
      const matches =
        mode.needle === ""
          ? input.recent
          : createFileRanking(
              (input.files ?? []).filter((file) => !mentionsFolder(file)),
              MATCH_LIMIT,
            )(mode.needle);

      return matches.map((file) => {
        const slash = file.displayPath.lastIndexOf("/");

        return {
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
        .filter((symbol) => symbol.name.toLocaleLowerCase().includes(mode.needle))
        .map((symbol) => ({
          key: `symbol:${String(symbol.line)}:${symbol.name}`,
          label: symbol.name,
          detail: `${symbol.kind} \u00b7 line ${String(symbol.line)}`,
          run: () => input.onGoTo(symbol.line, undefined),
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
      return mode.needle === "" ? "Type to find a file" : "No files match";
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
