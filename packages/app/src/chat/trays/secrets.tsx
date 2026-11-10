import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { SecretDays } from "@nyte-ai/plugin/secret/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Toggle } from "@nyte-ai/ui/toggle";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { openExternal } from "../../lib/open-external.ts";
import { tray } from "../../theme/schema.stylex.ts";
import { Tray, trayParts, useTrayRoot } from "./tray.tsx";
import { useDismissSecret, useSaveSecret, useSecretRequest } from "./secrets-state.ts";
import type { SecretRequest } from "./secrets-state.ts";

const LIFETIMES: readonly { readonly days: SecretDays; readonly label: string }[] = [
  { days: 1, label: "Delete after 24 hours" },
  { days: 3, label: "Delete after 3 days" },
  { days: 7, label: "Delete after 7 days" },
  { days: 30, label: "Delete after 30 days" },
  { days: null, label: "Never delete" },
];

const styles = create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: tray.paddingInline,
  },
  group: { display: "flex", flexDirection: "column", gap: space.s1 },
  body: { display: "flex", flexDirection: "column", gap: space.s2 },
  heading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.s1,
  },
  page: { marginInlineStart: "auto" },
  title: {
    display: "flex",
    flex: "1 1 auto",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    margin: 0,
    color: role.contentPrimary,
    fontWeight: type.weightSemibold,
  },
  glyph: { display: "inline-flex", color: role.contentTertiary },
  secondary: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
  actions: { display: "flex", alignItems: "center", gap: space.s2, marginInlineStart: "auto" },
  lifetime: { display: "inline-flex", alignItems: "center", gap: space.s1_5 },
  caution: { display: "inline-flex", color: role.contentTertiary },
});

function LifetimeLabel({ days }: { readonly days: SecretDays }): ReactElement {
  const label = LIFETIMES.find((option) => option.days === days)?.label ?? "";

  return (
    <span {...props(styles.lifetime)}>
      {label}
      {days === null && (
        <span {...props(styles.caution)}>
          <Icon name="warning" size="sm" />
        </span>
      )}
    </span>
  );
}

function SecretCard({
  target,
  disabled,
}: {
  readonly target: SecretRequest;
  readonly disabled: boolean;
}): ReactElement {
  const id = useId();
  const saveSecret = useSaveSecret();
  const dismiss = useDismissSecret();
  const request = target.request;
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [missing, setMissing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [days, setDays] = useState<SecretDays>(1);
  const blocked = disabled || saveSecret.isPending || saveSecret.isSuccess || dismiss.isPending;
  const error = saveSecret.error ?? dismiss.error;
  const page = request.url === null ? null : URL.parse(request.url);

  const save = (): void => {
    if (blocked) return;

    if (value.trim() === "") {
      setMissing(true);
      input.current?.focus();

      return;
    }

    saveSecret.mutate({ target, value, days });
  };

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      data-part="ask/secret"
      {...props(styles.card)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || blocked) return;
        event.preventDefault();
        event.stopPropagation();
        dismiss.mutate(target);
      }}
    >
      <div {...props(styles.body)}>
        <div {...props(styles.group)}>
          <div {...props(styles.heading)}>
            <h2 id={`${id}-title`} {...props(text.base, styles.title)}>
              <span {...props(styles.glyph)}>
                <Icon name="key" size="sm" />
              </span>
              {request.label}
            </h2>
            {page !== null && (
              <ButtonLink
                href={page.href}
                target="_blank"
                rel="noreferrer"
                size="xs"
                icon="globe"
                xstyle={styles.page}
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(page.href);
                }}
              >
                Open {page.host}
              </ButtonLink>
            )}
          </div>
          <p id={`${id}-reason`} {...props(text.sm, styles.secondary)}>
            {request.reason}
          </p>
          {target.origin !== undefined && (
            <p {...props(text.sm, styles.secondary)}>Asked by {target.origin}</p>
          )}
        </div>
        <InputGroup aria-invalid={missing}>
          <Input
            ref={input}
            autoFocus
            aria-labelledby={`${id}-title`}
            aria-describedby={`${missing ? `${id}-missing ` : ""}${id}-reason ${id}-note`}
            aria-invalid={missing}
            type={revealed ? "text" : "password"}
            placeholder="Paste it here"
            value={value}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            disabled={blocked}
            onValueChange={(next) => {
              setValue(next);
              setMissing(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              save();
            }}
          />
          <Toggle
            iconOnly
            size="sm"
            icon="eye"
            aria-label={`Show ${request.label}`}
            pressed={revealed}
            disabled={blocked}
            onPressedChange={setRevealed}
          />
        </InputGroup>
        <div {...props(styles.group)}>
          {missing && (
            <p id={`${id}-missing`} {...props(text.sm, intent.danger, styles.secondary)}>
              Paste the {request.label} first.
            </p>
          )}
          <p id={`${id}-note`} {...props(text.sm, styles.secondary)}>
            Saved to a private file only the agent's commands can read.
          </p>
        </div>
      </div>
      <div {...props(styles.footer)}>
        <Select
          items={LIFETIMES.map((option) => ({ value: option.days, label: option.label }))}
          value={days}
          onValueChange={(next) => {
            const picked = LIFETIMES.find((option) => option.days === next);

            if (picked !== undefined) setDays(picked.days);
          }}
        >
          <SelectTrigger aria-label="Delete after" disabled={blocked}>
            <SelectValue>{() => <LifetimeLabel days={days} />}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LIFETIMES.map((option) => (
              <SelectItem key={option.label} value={option.days} label={option.label}>
                <LifetimeLabel days={option.days} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div {...props(styles.actions)}>
          <Button
            aria-keyshortcuts="Escape"
            disabled={blocked}
            onClick={() => dismiss.mutate(target)}
          >
            Decline
          </Button>
          <Button variant="solid" loading={saveSecret.isPending} disabled={blocked} onClick={save}>
            Save
          </Button>
        </div>
      </div>
      {error !== null && (
        <p role="alert" {...props(text.sm, intent.danger, styles.secondary)}>
          {error.message}
        </p>
      )}
    </div>
  );
}

export function SecretTray({
  sessionId,
  disabled,
  viewport,
}: {
  readonly sessionId: SessionId;
  readonly disabled: boolean;
  readonly viewport: HTMLElement | null;
}): ReactElement {
  const target = useSecretRequest(sessionId);
  const { ref } = useTrayRoot(viewport);

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={target !== undefined} label="Secret">
        {target !== undefined && (
          <SecretCard
            key={`${target.sessionId}:${target.request.part}`}
            target={target}
            disabled={disabled}
          />
        )}
      </Tray>
    </div>
  );
}
