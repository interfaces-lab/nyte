import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { revealLabel } from "../components/context-menu.ts";
import { nyte } from "../nyte.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { customizeStyles as styles } from "./customize.stylex.ts";

export function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>{title}</h2>
        {description !== undefined && (
          <p {...props(settingsPatterns.sectionDescription)}>{description}</p>
        )}
      </div>
      <div {...props(settingsPatterns.group)}>{children}</div>
    </section>
  );
}

export function ExpandButton({
  name,
  open,
  onToggle,
}: {
  readonly name: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      iconOnly
      icon={open ? "chevron-down" : "chevron-right"}
      aria-label={`${name} details`}
      aria-expanded={open}
      onClick={onToggle}
    />
  );
}

export function Details({ children }: { readonly children: ReactNode }): ReactElement {
  return <div {...props(text.base, styles.details)}>{children}</div>;
}

export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <>
      <span {...props(styles.label)}>{label}</span>
      <div {...props(styles.value)}>{children}</div>
    </>
  );
}

export function Wide({ children }: { readonly children: ReactNode }): ReactElement {
  return <div {...props(styles.wide)}>{children}</div>;
}

export function Chips({
  names,
  label,
}: {
  readonly names: readonly string[];
  readonly label: string;
}): ReactElement {
  return (
    <span role="list" aria-label={label} {...props(styles.chips)}>
      {names.map((name) => (
        <span key={name} role="listitem" {...props(text.code, styles.chip)}>
          {name}
        </span>
      ))}
    </span>
  );
}

export function PathActions({ path }: { readonly path: string }): ReactElement {
  const reveal = nyte.host.revealPath;

  return (
    <>
      <span {...props(text.sm, styles.path)}>{path}</span>
      <span {...props(styles.actions)}>
        {reveal !== undefined && (
          <Button variant="outline" icon="folder-open" onClick={() => void reveal({ path })}>
            {revealLabel(nyte.platform)}
          </Button>
        )}
        <Button
          variant="outline"
          icon="copy"
          onClick={() => void navigator.clipboard.writeText(path)}
        >
          Copy Path
        </Button>
      </span>
    </>
  );
}

export function Notice({ children }: { readonly children: ReactNode }): ReactElement {
  return <p {...props(settingsPatterns.sectionDescription, styles.empty)}>{children}</p>;
}

export function ListLoading(): ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading" {...props(settingsPatterns.group)}>
      {["first", "second", "third"].map((key) => (
        <div key={key} {...props(settingsPatterns.row)}>
          <div {...props(styles.loadingLine)} />
        </div>
      ))}
    </div>
  );
}
