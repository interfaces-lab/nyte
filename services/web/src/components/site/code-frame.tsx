import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { Tabs } from "@nyte-ai/ui/tabs";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create } from "@stylexjs/stylex";
import { glyphs } from "~/lib/glyphs";
import { createContext, use, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentProps, ReactNode } from "react";

const { IconCheckmark1Small, IconClipboard } = glyphs;

export type CodeFrameProps = ComponentProps<"pre"> & {
  title?: string;
  icon?: unknown;
};

const frameworkLogos: Record<string, string> = {
  Vite: "vite",
  "Next.js": "nextjs",
  Svelte: "svelte",
  Vue: "vue",
  Nuxt: "nuxt",
  Solid: "solidjs",
};

function LabelIcon({ label }: { label: string }) {
  const logo = frameworkLogos[label];
  if (logo) return <img src={`/frameworks/${logo}.svg`} alt="" width={14} height={14} />;
  if (!/\.[a-z0-9]+$/i.test(label) || /^[A-Z][a-z]+\.js$/.test(label)) return null;

  return <FileTypeIcon path={label} />;
}

const InCodeTabs = createContext(false);

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

export function CodeFrame({ title, icon: _icon, children, className, ...props }: CodeFrameProps) {
  const body = useRef<HTMLPreElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  useMountEffect(() => () => clearTimeout(reset.current));

  const code = (
    <div className="doc-code-body">
      <pre ref={body} className={className} {...props}>
        {children}
      </pre>
      <button
        type="button"
        className="doc-code-copy"
        aria-label={copyStatus === "copied" ? "Copied" : "Copy code"}
        onClick={async () => {
          clearTimeout(reset.current);
          try {
            await navigator.clipboard.writeText(body.current?.textContent ?? "");
            setCopyStatus("copied");
            reset.current = setTimeout(() => setCopyStatus("idle"), 1300);
          } catch {
            setCopyStatus("error");
          }
        }}
      >
        {copyStatus === "copied" ? <IconCheckmark1Small size={14} /> : <IconClipboard size={14} />}
      </button>
      <p
        role="status"
        className={copyStatus === "error" ? "px-4 py-3 text-sm text-muted-foreground" : "sr-only"}
      >
        {copyStatus === "error"
          ? "Couldn’t copy code. Select the code and copy it manually."
          : copyStatus === "copied"
            ? "Code copied."
            : ""}
      </p>
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
