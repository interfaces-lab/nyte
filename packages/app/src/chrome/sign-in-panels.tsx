/**
 * What a sign-in shows while it waits on the user: a device code to carry to
 * the provider's site, or the page a browser sign-in finishes on. Settings ›
 * Models and Settings › Accounts both use them. The row that holds a panel
 * owns its Cancel button, so a panel never repeats it.
 */
import { props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { toast } from "@nyte-ai/ui/toast";
import type { BrowserSignIn, DeviceCode } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";

/** The site a verification link points at, for a button that says where it goes. */
function linkHost(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).hostname : undefined;
}

/** Where a verification link goes, as people would type it: host and path, no scheme. */
function linkText(url: string): string {
  if (!URL.canParse(url)) return url;
  const { host, pathname } = new URL(url);

  return pathname === "/" ? host : `${host}${pathname}`;
}

/**
 * The code is the one thing to read, so it sits first and largest, beside where
 * to enter it. The flow's messages sit under it so a poll update never hides
 * what the user still has to type.
 */
export function DeviceCodePanel({
  deviceCode,
  message,
}: {
  deviceCode: DeviceCode;
  message: string | undefined;
}): ReactElement {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const { userCode, verificationUri, expiresInSeconds, instructions } = deviceCode;

  const expiryMinutes =
    expiresInSeconds === undefined ? undefined : Math.max(1, Math.round(expiresInSeconds / 60));

  return (
    <div {...props(styles.deviceCodePanel)}>
      <div {...props(styles.deviceCodeBox)}>
        <code aria-label="Device code" {...props(styles.deviceCode)}>
          {userCode}
        </code>
        <span {...props(styles.deviceCodeLead)}>
          Enter this code on{" "}
          <a
            href={verificationUri}
            target="_blank"
            rel="noreferrer"
            {...props(styles.deviceCodeLink)}
            onClick={(event) => {
              event.preventDefault();
              void nyte.host.openExternal({ url: verificationUri }).catch(() =>
                toast.add({
                  type: "error",
                  title: `Couldn't open ${linkText(verificationUri)}. Enter the code there yourself.`,
                }),
              );
            }}
          >
            {linkText(verificationUri)}
          </a>
          {expiryMinutes !== undefined && `. It expires in about ${String(expiryMinutes)} min.`}
        </span>
        <Button
          iconOnly
          icon={copyStatus === "copied" ? "checkmark" : "copy"}
          aria-label="Copy Sign-In Code"
          onClick={() => {
            void navigator.clipboard.writeText(userCode).then(
              () => setCopyStatus("copied"),
              () => setCopyStatus("failed"),
            );
          }}
        />
      </div>
      {instructions !== undefined && <span {...props(styles.deviceCodeNote)}>{instructions}</span>}
      {copyStatus === "copied" && (
        <span role="status" {...props(srOnly)}>
          Sign-in code copied
        </span>
      )}
      {copyStatus === "failed" && (
        <span role="alert" {...props(styles.deviceCodeNote)}>
          Couldn&rsquo;t copy the code. Select it and copy it yourself.
        </span>
      )}
      {message !== undefined && (
        <span role="status" aria-live="polite" {...props(styles.deviceCodeNote)}>
          {message}
        </span>
      )}
    </div>
  );
}

/** The code or address a browser sign-in's page ended on, sent once. */
function AnswerForm({ answer }: { answer: (code: string) => Promise<void> }): ReactElement {
  const [code, setCode] = useState("");

  const send = useMutation({
    mutationFn: answer,
    onError: () => toast.add({ type: "error", title: "Couldn't send the code. Try again." }),
  });

  if (send.isSuccess) {
    return (
      <span role="status" {...props(styles.deviceCodeNote)}>
        Finishing sign-in…
      </span>
    );
  }

  return (
    <form
      {...props(styles.keyRow)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!send.isPending && code.trim() !== "") send.mutate(code.trim());
      }}
    >
      <Input
        variant="quiet"
        aria-label="Code or address"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste the code or address"
        value={code}
        disabled={send.isPending}
        xstyle={styles.keyInput}
        onValueChange={setCode}
      />
      <Button
        type="submit"
        variant="outline"
        loading={send.isPending}
        disabled={code.trim() === ""}
      >
        Finish Sign-In
      </Button>
    </form>
  );
}

/**
 * Finishing on a page the host cannot open for the user. The link opens from
 * a click, so the browser does not block it. When the attempt accepts a code,
 * the user pastes what the page ended on: its code, or the address it tried
 * to load on the serving machine.
 */
export function BrowserSignInPanel({
  attempt,
  browser,
  message,
}: {
  attempt: string;
  browser: BrowserSignIn;
  message: string | undefined;
}): ReactElement {
  const host = linkHost(browser.url);
  const answerLogin = browser.acceptsCode ? nyte.host.answerLogin : undefined;

  return (
    <div {...props(styles.deviceCodePanel)}>
      {answerLogin !== undefined && (
        <span {...props(styles.deviceCodeLead)}>
          Sign in at {host ?? "the provider's page"}, then paste the code it shows or the address it
          ends on.
        </span>
      )}
      {browser.instructions !== undefined && (
        <span {...props(styles.deviceCodeNote)}>{browser.instructions}</span>
      )}
      <div {...props(styles.deviceCodeRow)}>
        <ButtonLink
          href={browser.url}
          target="_blank"
          rel="noreferrer"
          variant="solid"
          tone="primary"
          onClick={(event) => {
            event.preventDefault();
            void nyte.host
              .openExternal({ url: browser.url })
              .catch(() =>
                toast.add({ type: "error", title: `Couldn't open ${host ?? "the sign-in page"}.` }),
              );
          }}
        >
          {host === undefined ? "Open Sign-In Page" : `Open ${host}`}
        </ButtonLink>
      </div>
      {answerLogin !== undefined && (
        <AnswerForm answer={(code) => answerLogin({ attempt, code })} />
      )}
      <span role="status" aria-live="polite" {...props(styles.deviceCodeNote)}>
        {message ??
          (answerLogin === undefined ? "Nyte connects on its own once you sign in." : undefined)}
      </span>
    </div>
  );
}
