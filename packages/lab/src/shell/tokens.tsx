import { create, props } from "@stylexjs/stylex";
import { useId, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Input, Textarea } from "@nyte-ai/ui/input";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useLabSearch } from "./use-lab-search.ts";

const styles = create({
  root: { display: "flex", flexDirection: "column", gap: space.s4 },
  section: { display: "flex", flexDirection: "column", gap: space.s2 },
  heading: { margin: 0, color: role.contentSecondary, fontWeight: type.weightMedium },
  note: { margin: 0, color: role.contentTertiary },
  row: { display: "flex", alignItems: "center", gap: space.s1 },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: type.fontMono,
  },
  value: { flex: 1, minWidth: 0 },
  code: { fontFamily: type.fontMono },
});

/**
 * Overrides for any `--nyte-*` token, and free CSS after them. Both land in the address and apply
 * to every element, the lab's own controls included, so nothing a prototype renders escapes them.
 */
export function TokenOverrides(): ReactElement {
  const lab = useLabSearch();
  const listId = useId();
  const [names] = useState(readTokenNames);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const tokens = lab.search.tokens ?? {};

  const write = (next: Readonly<Record<string, string>>): void =>
    lab.update({ tokens: Object.keys(next).length === 0 ? undefined : next });

  const add = (): void => {
    if (!/^--[\w-]+$/.test(name) || value.trim() === "") return;
    write({ ...tokens, [name]: value.trim() });
    setName("");
    setValue("");
  };

  return (
    <div {...props(styles.root)}>
      <section {...props(styles.section)}>
        <h3 {...props(text.sm, styles.heading)}>Tokens</h3>
        <datalist id={listId}>
          {names.map((token) => (
            <option key={token} value={token} />
          ))}
        </datalist>
        <form
          {...props(styles.section)}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            list={listId}
            value={name}
            placeholder="--nyte-bg-base"
            aria-label="Token"
            xstyle={styles.code}
            onValueChange={setName}
          />
          <div {...props(styles.row)}>
            <Input
              value={value}
              placeholder={currentValue(name)}
              aria-label="Value"
              xstyle={[styles.value, styles.code]}
              onValueChange={setValue}
            />
            <Button type="submit" size="sm" variant="outline">
              Override
            </Button>
          </div>
        </form>
        {Object.entries(tokens).map(([token, current]) => (
          <OverrideRow
            key={token}
            name={token}
            value={current}
            onChange={(next) => write({ ...tokens, [token]: next })}
            onRemove={() =>
              write(Object.fromEntries(Object.entries(tokens).filter(([key]) => key !== token)))
            }
          />
        ))}
        {Object.keys(tokens).length === 0 && (
          <p {...props(text.sm, styles.note)}>
            {names.length} tokens. An override applies to every element, so no theme scope keeps its
            own value.
          </p>
        )}
      </section>
      <CssOverride
        key={lab.search.css ?? ""}
        css={lab.search.css ?? ""}
        onChange={(css) => lab.update({ css: css.trim() === "" ? undefined : css })}
      />
    </div>
  );
}

function OverrideRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onRemove: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(value);

  return (
    <div {...props(styles.section)}>
      <div {...props(styles.row)}>
        <span title={name} {...props(text.sm, styles.name)}>
          {name}
        </span>
        <Button
          size="xs"
          variant="ghost"
          icon="close"
          iconOnly
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        />
      </div>
      <Input
        value={draft}
        aria-label={`${name} value`}
        xstyle={styles.code}
        onValueChange={setDraft}
        onBlur={() => onChange(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onChange(draft);
        }}
      />
    </div>
  );
}

function CssOverride({
  css,
  onChange,
}: {
  readonly css: string;
  readonly onChange: (css: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(css);

  return (
    <section {...props(styles.section)}>
      <h3 {...props(text.sm, styles.heading)}>CSS</h3>
      <Textarea
        value={draft}
        rows={6}
        spellCheck={false}
        placeholder="[data-slot='row'] { … }"
        aria-label="CSS"
        xstyle={styles.code}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(draft)}
      />
    </section>
  );
}

/** Every `--nyte-*` property any loaded stylesheet sets, layers and media rules included. */
function readTokenNames(): readonly string[] {
  return [
    ...new Set([...document.styleSheets].flatMap((sheet) => tokensIn(sheet.cssRules))),
  ].toSorted();
}

function tokensIn(rules: CSSRuleList): readonly string[] {
  return [...rules].flatMap((rule) => [
    ...(rule instanceof CSSStyleRule
      ? [...rule.style].filter((property) => property.startsWith("--nyte-"))
      : []),
    ...(rule instanceof CSSGroupingRule ? tokensIn(rule.cssRules) : []),
  ]);
}

function currentValue(name: string): string {
  if (!name.startsWith("--")) return "Value";

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "Value";
}
