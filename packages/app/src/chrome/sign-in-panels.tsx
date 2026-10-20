import { props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { toast } from "@nyte-ai/ui/toast";
import type { DeviceCode } from "../bridge.ts";
import { answerLogin } from "./login-attempts.ts";
import type { BrowserSignIn } from "./login-attempts.ts";
import { openExternal } from "../open-external.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";

function linkHost(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).hostname : undefined;
}

function linkText(url: string): string {
  if (!URL.canParse(url)) return url;
  const { host, pathname } = new URL(url);

  return pathname === "/" ? host : `${host}${pathname}`;
}

export function DeviceCodePanel({ deviceCode }: { deviceCode: DeviceCode }): ReactElement {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const { userCode, verificationUri, expiresInSeconds, instructions } = deviceCode;

  const expiryMinutes =
    expiresInSeconds === undefined ? undefined : Math.max(1, Math.round(expiresInSeconds / 60));

  return (
    <div {...props(styles.deviceCodePanel)}>
      <div {...props(styles.deviceCodeBox)}>
        <code aria-label="Device code" {...props(text.lg, styles.deviceCode)}>
          {userCode}
        </code>
        <span {...props(text.base, styles.deviceCodeLead)}>
          Enter this code on{" "}
          <a
            href={verificationUri}
            target="_blank"
            rel="noreferrer"
            {...props(styles.deviceCodeLink)}
            onClick={(event) => {
              event.preventDefault();
              openExternal(
                verificationUri,
                `Couldn't open ${linkText(verificationUri)}. Enter the code there yourself.`,
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
      {instructions !== undefined && (
        <span {...props(text.sm, styles.deviceCodeNote)}>{instructions}</span>
      )}
      {copyStatus === "copied" && (
        <span role="status" {...props(srOnly)}>
          Sign-in code copied
        </span>
      )}
      {copyStatus === "failed" && (
        <span role="alert" {...props(text.sm, styles.deviceCodeNote)}>
          Couldn&rsquo;t copy the code. Select it and copy it yourself.
        </span>
      )}
    </div>
  );
}

function AnswerForm({ answer }: { answer: (code: string) => Promise<void> }): ReactElement {
  const [code, setCode] = useState("");

  const send = useMutation({
    mutationFn: answer,
    onError: () => toast.add({ type: "error", title: "Couldn't send the code. Try again." }),
  });

  if (send.isSuccess) {
    return (
      <span role="status" {...props(text.sm, styles.deviceCodeNote)}>
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
        variant="code"
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

export function BrowserSignInPanel({
  provider,
  browser,
}: {
  provider: string;
  browser: BrowserSignIn;
}): ReactElement {
  const host = linkHost(browser.url);
  const acceptsCode = browser.acceptsCode;

  return (
    <div {...props(styles.deviceCodePanel)}>
      {acceptsCode && (
        <span {...props(text.base, styles.deviceCodeLead)}>
          Sign in at {host ?? "the provider's page"}, then paste the code it shows or the address it
          ends on.
        </span>
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
            openExternal(browser.url, `Couldn't open ${host ?? "the sign-in page"}.`);
          }}
        >
          {host === undefined ? "Open Sign-In Page" : `Open ${host}`}
        </ButtonLink>
      </div>
      {acceptsCode && <AnswerForm answer={(code) => answerLogin(provider, code)} />}
      <span role="status" aria-live="polite" {...props(text.sm, styles.deviceCodeNote)}>
        {acceptsCode ? undefined : "Nyte connects on its own once you sign in."}
      </span>
    </div>
  );
}
