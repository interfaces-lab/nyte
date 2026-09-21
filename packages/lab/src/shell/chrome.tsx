import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { AuditSurface } from "./audit-state";
import { chrome } from "./chrome.stylex";

/*
 * Controls for the lab, not for a product. Every string here names a state of
 * the test rig, so the copy is the switch and nothing else.
 */

export type Appearance = "light" | "dark";
export type BackdropKind = "photo" | "grid" | "flat";
export type TokenSet = "nyte" | "calendar";

type Option<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  legend: string;
  value: T | undefined;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
};

/* `value` may be undefined, and then no segment is lit. Hovering a submenu
 * open or dismissing a dialog leaves the stack in a state none of the presets
 * names, and the strip should say so rather than keep a stale one highlighted. */
function Segmented<T extends string>({ legend, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div {...stylex.props(chrome.field)}>
      <span {...stylex.props(chrome.legend)}>{legend}</span>
      <div {...stylex.props(chrome.segments)} role="group" aria-label={legend}>
        {options.map((option) => (
          <button
            key={option.value}
            {...stylex.props(chrome.segment, option.value === value && chrome.segmentOn)}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <select
        {...stylex.props(chrome.select)}
        aria-label={legend}
        value={value ?? ""}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.value === event.currentTarget.value);
          if (option !== undefined) onChange(option.value);
        }}
      >
        {value === undefined ? <option value="">Custom</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const appearances: ReadonlyArray<Option<Appearance>> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const backdrops: ReadonlyArray<Option<BackdropKind>> = [
  { value: "photo", label: "Photo" },
  { value: "grid", label: "Grid" },
  { value: "flat", label: "Flat" },
];

const tokenSets: ReadonlyArray<Option<TokenSet>> = [
  { value: "nyte", label: "A · Desktop" },
  { value: "calendar", label: "B · Calendar" },
];

const backdropStyles = {
  photo: chrome.photo,
  grid: chrome.grid,
  flat: chrome.flat,
} as const;

const surfaces: ReadonlyArray<Option<AuditSurface>> = [
  { value: "none", label: "None" },
  { value: "menu", label: "Menu" },
  { value: "submenu", label: "Submenu" },
  { value: "context", label: "Context menu" },
  { value: "popover", label: "Popover" },
  { value: "dialog", label: "Dialog" },
];

type StripProps = {
  surface: AuditSurface;
  onSurface: (value: AuditSurface) => void;
  appearance: Appearance;
  backdrop: BackdropKind;
  tokens: TokenSet;
  sidebarVisible: boolean;
  onSidebar: () => void;
  onTokenSet: (value: TokenSet) => void;
  onAppearance: (value: Appearance) => void;
  onBackdrop: (value: BackdropKind) => void;
  columns: boolean;
  rows: boolean;
  onColumns: () => void;
  onRows: () => void;
  tokensOpen: boolean;
  onTokens: () => void;
};

export function Strip(props: StripProps) {
  return (
    <div data-lab-controls="" {...stylex.props(chrome.strip)}>
      <Segmented
        legend="Appearance"
        value={props.appearance}
        options={appearances}
        onChange={props.onAppearance}
      />
      <Segmented
        legend="Tokens"
        value={props.tokens}
        options={tokenSets}
        onChange={props.onTokenSet}
      />
      <div {...stylex.props(chrome.field)}>
        <span {...stylex.props(chrome.legend)}>Surface</span>
        <select
          aria-label="Audit surface"
          value={props.surface}
          onChange={(event) => {
            const choice = surfaces.find((item) => item.value === event.currentTarget.value);
            if (choice !== undefined) props.onSurface(choice.value);
          }}
          {...stylex.props(chrome.surfaceSelect)}
        >
          {surfaces.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        aria-pressed={props.sidebarVisible}
        onClick={props.onSidebar}
        {...stylex.props(chrome.segment, props.sidebarVisible && chrome.segmentOn)}
      >
        Sidebar
      </button>
      <div {...stylex.props(chrome.field)} role="group" aria-label="Guides">
        <button
          type="button"
          aria-pressed={props.columns}
          onClick={props.onColumns}
          {...stylex.props(chrome.segment, props.columns && chrome.segmentOn)}
        >
          Columns
        </button>
        <button
          type="button"
          aria-pressed={props.rows}
          onClick={props.onRows}
          {...stylex.props(chrome.segment, props.rows && chrome.segmentOn)}
        >
          Rows
        </button>
      </div>
      <button
        type="button"
        aria-pressed={props.tokensOpen}
        onClick={props.onTokens}
        {...stylex.props(chrome.segment, props.tokensOpen && chrome.segmentOn)}
      >
        DialKit
      </button>
      <Segmented
        legend="Backdrop"
        value={props.backdrop}
        options={backdrops}
        onChange={props.onBackdrop}
      />
    </div>
  );
}

export function Page({
  backdrop,
  children,
  inspecting = false,
}: {
  backdrop: BackdropKind;
  children: ReactNode;
  inspecting?: boolean;
}) {
  return (
    <div {...stylex.props(chrome.page, inspecting && chrome.pageInspecting)}>
      <div {...stylex.props(chrome.backdrop, backdropStyles[backdrop])} />
      <div {...stylex.props(chrome.stage)}>{children}</div>
    </div>
  );
}
