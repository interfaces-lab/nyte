import { FileTypeIcon } from "@nyte-ai/app/components/file-type-icon.tsx";
import { Tabs } from "@nyte-ai/ui/tabs";
import { create } from "@stylexjs/stylex";
import { IconCheckmark1Small, IconClipboard } from "central-icons";
import { createContext, use, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentProps, ReactNode } from "react";

export type CodeFrameProps = ComponentProps<"pre"> & {
  title?: string;
  icon?: unknown;
};

/** Framework logos from svgl.app, served from `public/frameworks`. */
const frameworkLogos: Record<string, string> = {
  Vite: "vite",
  "Next.js": "nextjs",
  Svelte: "svelte",
  Vue: "vue",
  Nuxt: "nuxt",
  Solid: "solidjs",
};

/** A tab or title's icon: a framework's logo, or a file-type icon when it names a file. */
function LabelIcon({ label }: { label: string }) {
  const logo = frameworkLogos[label];
  if (logo) return <img src={`/frameworks/${logo}.svg`} alt="" width={14} height={14} />;
  if (!/\.[a-z0-9]+$/i.test(label) || /^[A-Z][a-z]+\.js$/.test(label)) return null;

  return <FileTypeIcon path={label} />;
}

/** Set inside `CodeBlockTabs`, whose figure and tab strip already frame each file. */
const InCodeTabs = createContext(false);

/** The tab chosen in each `groupId`, so picking a framework once switches every block in the group. */
const groupChoices = new Map<string, string>();

const groupListeners = new Set<() => void>();

function subscribeToGroups(listener: () => void) {
  groupListeners.add(listener);

  return () => groupListeners.delete(listener);
}

function chooseInGroup(groupId: string, value: string) {
  groupChoices.set(groupId, value);

  for (const listener of groupListeners) listener();
}

function useGroupChoice(groupId: string | undefined) {
  return useSyncExternalStore(
    subscribeToGroups,
    () => (groupId ? groupChoices.get(groupId) : undefined),
    () => undefined,
  );
}

const styles = create({
  list: { gap: 0 },
});

/**
 * The `pre` renderer for doc pages. fumadocs-mdx hands us Shiki's output
 * plus fence meta; `title` becomes the file's tab, the way an editor shows
 * it. The copy button reads the rendered text so it never disagrees with
 * what is on screen.
 */
export function CodeFrame({ title, icon: _icon, children, className, ...props }: CodeFrameProps) {
  const body = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const code = (
    <div className="doc-code-body">
      <pre ref={body} className={className} {...props}>
        {children}
      </pre>
      <button
        type="button"
        className="doc-code-copy"
        aria-label={copied ? "Copied" : "Copy code"}
        onClick={async () => {
          await navigator.clipboard.writeText(body.current?.textContent ?? "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1300);
        }}
      >
        {copied ? <IconCheckmark1Small size={14} /> : <IconClipboard size={14} />}
      </button>
    </div>
  );

  if (use(InCodeTabs)) return code;

  return (
    <figure className="doc-code">
      {title ? (
        <div className="doc-code-tabs">
          <span className="doc-code-tab" data-active="">
            <LabelIcon label={title} />
            {title}
          </span>
        </div>
      ) : null}
      {code}
    </figure>
  );
}

/**
 * Consecutive fences that each carry `tab="file.ts"` become one block with
 * a tab per file; fumadocs' `remarkCodeTab` emits these four components.
 * Blocks sharing a `groupId` keep the same tab chosen, and `GroupPanel`
 * follows that choice.
 */
export function CodeBlockTabs({
  defaultValue,
  groupId,
  children,
}: {
  defaultValue?: string;
  groupId?: string;
  persist?: boolean;
  children?: ReactNode;
}) {
  const chosen = useGroupChoice(groupId);

  return (
    <InCodeTabs value>
      <figure className="doc-code">
        {groupId ? (
          <Tabs.Root
            value={chosen ?? defaultValue}
            onValueChange={(value) => chooseInGroup(groupId, String(value))}
          >
            {children}
          </Tabs.Root>
        ) : (
          <Tabs.Root defaultValue={defaultValue}>{children}</Tabs.Root>
        )}
      </figure>
    </InCodeTabs>
  );
}

/** Prose and code for one tab of a `groupId`, shown only while that tab is chosen anywhere on the page. */
export function GroupPanel({
  groupId,
  value,
  defaultValue,
  children,
}: {
  groupId: string;
  value: string;
  defaultValue: string;
  children?: ReactNode;
}) {
  const chosen = useGroupChoice(groupId) ?? defaultValue;

  return chosen === value ? children : null;
}

export function CodeBlockTabsList({ children }: { children?: ReactNode }) {
  return (
    <div className="doc-code-tabs">
      <Tabs.List xstyle={styles.list}>{children}</Tabs.List>
    </div>
  );
}

export function CodeBlockTabsTrigger({ value, children }: { value: string; children?: ReactNode }) {
  return (
    <Tabs.Tab variant="bare" value={value}>
      <span className="doc-code-tab">
        <LabelIcon label={value} />
        {children}
      </span>
    </Tabs.Tab>
  );
}

export function CodeBlockTab({ value, children }: { value: string; children?: ReactNode }) {
  return <Tabs.Panel value={value}>{children}</Tabs.Panel>;
}
