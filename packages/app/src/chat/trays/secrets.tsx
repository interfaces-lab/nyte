import { create, props } from "@stylexjs/stylex";
import { useId, useState } from "react";
import type { ReactElement } from "react";
import type { SecretDays } from "@nyte-ai/plugin/secret/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Toggle } from "@nyte-ai/ui/toggle";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
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
  heading: { display: "flex", flexDirection: "column", gap: space.s1 },
  kind: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    margin: 0,
    color: role.contentSecondary,
  },
  kindLabel: { flex: 1 },
  title: { margin: 0, color: role.contentPrimary, fontWeight: type.weightMedium },
  secondary: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  entry: { display: "flex", alignItems: "center", gap: space.s1_5 },
  input: { flex: 1, minWidth: 0 },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
  actions: { display: "flex", alignItems: "center", gap: space.s2 },
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
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [days, setDays] = useState<SecretDays>(1);
  const blocked = disabled || saveSecret.isPending || saveSecret.isSuccess || dismiss.isPending;
  const error = saveSecret.error ?? dismiss.error;
  const page = request.url === null ? null : URL.parse(request.url);

  const save = (): void => {
    if (!blocked && value.trim() !== "") saveSecret.mutate({ target, value, days });
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
      <div {...props(styles.heading)}>
        <p {...props(text.sm, styles.kind)}>
          <Icon name="key" size="sm" />
          <span {...props(styles.kindLabel)}>Secret</span>
        </p>
        <h2 id={`${id}-title`} {...props(text.base, styles.title)}>
          {request.label}
        </h2>
        <p {...props(text.sm, styles.secondary)}>{request.reason}</p>
        {target.origin !== undefined && (
          <p {...props(text.sm, styles.secondary)}>Asked by {target.origin}</p>
        )}
      </div>
      {page !== null && (
        <div>
          <ButtonLink
            href={page.href}
            target="_blank"
            rel="noreferrer"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.preventDefault();
              openExternal(page.href);
            }}
          >
            Open {page.host}
          </ButtonLink>
        </div>
      )}
      <div {...props(styles.entry)}>
        <Input
          autoFocus
          aria-labelledby={`${id}-title`}
          type={revealed ? "text" : "password"}
          placeholder={`Paste the ${request.label}`}
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          disabled={blocked}
          xstyle={styles.input}
          onValueChange={setValue}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            save();
          }}
        />
        <Toggle
          iconOnly
          icon="eye"
          aria-label={`Show ${request.label}`}
          pressed={revealed}
          onPressedChange={setRevealed}
        />
      </div>
      <p {...props(text.sm, styles.secondary)}>
        Saved to a private file. The agent gets its path, and only commands it runs can read it.
      </p>
      <div {...props(styles.footer)}>
        <Button
          size="sm"
          aria-keyshortcuts="Escape"
          disabled={blocked}
          onClick={() => dismiss.mutate(target)}
        >
          Decline
        </Button>
        <div {...props(styles.actions)}>
          <Select
            items={LIFETIMES.map((option) => ({ value: option.days, label: option.label }))}
            value={days}
            onValueChange={(next) => {
              const picked = LIFETIMES.find((option) => option.days === next);

              if (picked !== undefined) setDays(picked.days);
            }}
          >
            <SelectTrigger aria-label="When to Delete" disabled={blocked}>
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
          <Button
            size="sm"
            variant="solid"
            loading={saveSecret.isPending}
            disabled={blocked || value.trim() === ""}
            onClick={save}
          >
            Save
          </Button>
        </div>
      </div>
      {error !== null && (
        <p role="alert" {...props(text.sm, styles.secondary)}>
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
