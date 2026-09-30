/**
 * What a sign-in shows while it waits on the user: a device code to carry to
 * the provider's site, or the page a browser sign-in finishes on. Settings ›
 * Models and Settings › Accounts both use them. The row that holds a panel
 * owns its Cancel button, so a panel never repeats it.
 */
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { toast } from "@nyte-ai/ui/toast";
import type { BrowserSignIn, DeviceCode } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";

/** The site a verification link points at, for a button that says where it goes. */
function linkHost(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).hostname : undefined;
}

/**
 * The code and the provider's instructions stay on screen until the attempt
 * ends; the flow's messages sit under them so a poll update never hides what
 * the user still has to type or read.
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
  const host = linkHost(verificationUri);

  const expiryMinutes =
    expiresInSeconds === undefined ? undefined : Math.max(1, Math.round(expiresInSeconds / 60));

  const openLabel = host === undefined ? "Open link" : `Open ${host}`;

  return (
    <div {...stylex.props(styles.deviceCodePanel)}>
      <span {...stylex.props(styles.deviceCodeLead)}>
        Enter this code at {verificationUri} to continue signing in.
        {expiryMinutes !== undefined && ` It expires in about ${String(expiryMinutes)} min.`}
      </span>
      {instructions !== undefined && (
        <span {...stylex.props(styles.deviceCodeNote)}>{instructions}</span>
      )}
      <div {...stylex.props(styles.deviceCodeRow)}>
        <code aria-label="Device code" {...stylex.props(styles.deviceCode)}>
          {userCode}
        </code>
        <Button
          variant="secondary"
          icon={copyStatus === "copied" ? "checkmark" : "copy"}
          onClick={() => {
            void navigator.clipboard.writeText(userCode).then(
              () => setCopyStatus("copied"),
              () => setCopyStatus("failed"),
            );
          }}
        >
          {copyStatus === "copied" ? "Copied" : "Copy code"}
        </Button>
        <Button
          variant="inverse"
          onClick={() =>
            void nyte.host
              .openExternal({ url: verificationUri })
              .catch(() =>
                toast.error(`Couldn't open ${host ?? "the link"}. Enter the code there yourself.`),
              )
          }
        >
          {openLabel}
        </Button>
      </div>
      {copyStatus === "failed" && (
        <span role="alert" {...stylex.props(styles.deviceCodeNote)}>
          Couldn&rsquo;t copy the code. Select it and copy it yourself.
        </span>
      )}
      <span role="status" aria-live="polite" {...stylex.props(styles.deviceCodeNote)}>
        {message ?? "Nyte connects on its own once you approve."}
      </span>
    </div>
  );
}

/** The code or address a browser sign-in's page ended on, sent once. */
function AnswerForm({ answer }: { answer: (code: string) => Promise<void> }): ReactElement {
  const [code, setCode] = useState("");

  const send = useMutation({
    mutationFn: answer,
    onError: () => toast.error("Couldn't send the code. Try again."),
  });

  if (send.isSuccess) {
    return (
      <span role="status" {...stylex.props(styles.deviceCodeNote)}>
        Finishing sign-in…
      </span>
    );
  }

  return (
    <form
      {...stylex.props(styles.keyRow)}
      onSubmit={(event) => {
        event.preventDefault();

        if (code.trim() !== "") send.mutate(code.trim());
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
      <Button type="submit" variant="secondary" disabled={send.isPending || code.trim() === ""}>
        Continue
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
    <div {...stylex.props(styles.deviceCodePanel)}>
      {answerLogin !== undefined && (
        <span {...stylex.props(styles.deviceCodeLead)}>
          Sign in at {host ?? "the provider's page"}, then paste the code it shows or the address it
          ends on.
        </span>
      )}
      {browser.instructions !== undefined && (
        <span {...stylex.props(styles.deviceCodeNote)}>{browser.instructions}</span>
      )}
      <div {...stylex.props(styles.deviceCodeRow)}>
        <Button
          variant="inverse"
          onClick={() =>
            void nyte.host
              .openExternal({ url: browser.url })
              .catch(() => toast.error(`Couldn't open ${host ?? "the sign-in page"}.`))
          }
        >
          {host === undefined ? "Open sign-in page" : `Open ${host}`}
        </Button>
      </div>
      {answerLogin !== undefined && (
        <AnswerForm answer={(code) => answerLogin({ attempt, code })} />
      )}
      <span role="status" aria-live="polite" {...stylex.props(styles.deviceCodeNote)}>
        {message ??
          (answerLogin === undefined ? "Nyte connects on its own once you sign in." : undefined)}
      </span>
    </div>
  );
}
