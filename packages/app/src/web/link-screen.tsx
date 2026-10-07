/**
 * `/link`: approve a host that has no browser of its own. The host printed a
 * page, a code and a key fingerprint; the owner signs in here, enters the
 * code, and approves only when the fingerprint shown matches the terminal.
 * Nothing happens on page load or from the address bar: every step is a
 * POST under the signed-in session.
 */
import { ClerkFailed, ClerkLoading, ClerkProvider, SignIn, useAuth, useClerk } from "@clerk/react";
import { BrokerError, createBrokerClient, normalizeUserCode } from "@nyte-ai/connect";
import type { LinkTransactionLookup } from "@nyte-ai/connect";
import type { AccountConfig } from "@nyte-ai/connect/account-config";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { AccountScope, accountAppearance } from "../account/appearance.tsx";
import { accountProblem } from "./account-copy.ts";
import { WebPage } from "./web-page.tsx";

const styles = create({
  form: { display: "flex", flexDirection: "column", gap: 16 },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  label: { fontWeight: 500 },
  error: { margin: 0, fontSize: type.fontSm, lineHeight: type.leadingSm },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  row: { display: "flex", flexDirection: "column", gap: 2 },
  key: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  value: { overflowWrap: "anywhere" },
  mono: { fontFamily: type.fontMono, fontSize: type.fontCode, userSelect: "text" },
  actions: { display: "flex", gap: 8, justifyContent: "flex-end" },
  status: { margin: 0, color: role.contentSecondary, textAlign: "center" },
});

type Step =
  | { readonly kind: "code" }
  | { readonly kind: "review"; readonly lookup: LinkTransactionLookup }
  | { readonly kind: "approved" }
  | { readonly kind: "denied" };

function lookupProblem(cause: unknown): string {
  if (cause instanceof BrokerError && cause.failure.kind === "refused") {
    if (cause.failure.code === "not_found")
      return "No host is waiting on that code. Check the code in the terminal; it expires five minutes after it was shown.";

    if (cause.failure.code === "rate_limited")
      return "Too many tries. Wait a minute, then try again.";
  }

  return accountProblem(cause);
}

function LinkFlow({ config }: { readonly config: AccountConfig }): ReactElement {
  const clerk = useClerk();
  const { getToken } = useAuth();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "code" });
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const broker = useMemo(
    () =>
      createBrokerClient({
        origin: config.origin,
        sessionToken: () =>
          clerk.session?.status === "active"
            ? getToken({ skipCache: true })
            : Promise.resolve(null),
      }),
    [clerk, config.origin, getToken],
  );

  const lookUp = async (): Promise<void> => {
    const userCode = normalizeUserCode(code);

    if (userCode === undefined) {
      setError("Enter the eight-character code from the terminal.");

      return;
    }

    setError(undefined);
    setPending(true);

    try {
      const lookup = await broker.lookupLinkTransaction({ userCode });
      setStep({ kind: "review", lookup });
    } catch (cause) {
      setError(lookupProblem(cause));
    } finally {
      setPending(false);
    }
  };

  const decide = async (lookup: LinkTransactionLookup, decision: "approve" | "deny") => {
    setError(undefined);
    setPending(true);

    try {
      const status =
        decision === "approve"
          ? await broker.approveLinkTransaction({
              transactionId: lookup.transactionId,
              fingerprint: lookup.fingerprint,
            })
          : await broker.denyLinkTransaction({ transactionId: lookup.transactionId });
      setStep({ kind: status.state === "approved" ? "approved" : "denied" });
    } catch (cause) {
      setError(
        cause instanceof BrokerError &&
          cause.failure.kind === "refused" &&
          (cause.failure.code === "not_found" || cause.failure.code === "conflict")
          ? "This request is no longer waiting. Start again in the terminal."
          : accountProblem(cause),
      );
    } finally {
      setPending(false);
    }
  };

  const email = clerk.user?.primaryEmailAddress?.emailAddress ?? clerk.user?.id ?? "";

  switch (step.kind) {
    case "code":
      return (
        <WebPage
          title="Link a Host"
          description={`Signed in as ${email}. Enter the code the host printed.`}
          busy={pending}
        >
          <form
            {...props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              void lookUp();
            }}
          >
            <label {...props(styles.field)}>
              <span {...props(styles.label)}>Code</span>
              <Input
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX"
                value={code}
                readOnly={pending}
                aria-invalid={error !== undefined}
                aria-describedby={error !== undefined ? errorId : undefined}
                onValueChange={setCode}
              />
            </label>
            {error !== undefined && (
              <p id={errorId} role="alert" {...props(intent.danger, styles.error)}>
                {error}
              </p>
            )}
            <Button type="submit" variant="solid" tone="primary" loading={pending}>
              Continue
            </Button>
          </form>
        </WebPage>
      );
    case "review": {
      const { lookup } = step;

      return (
        <WebPage
          title="Approve This Host?"
          description="Approve only if the fingerprint matches the one in the terminal. Anyone can claim a name; only the fingerprint identifies the host's key."
          busy={pending}
        >
          <div {...props(styles.card)}>
            <div {...props(styles.row)}>
              <span {...props(styles.key)}>Account</span>
              <span {...props(styles.value)}>{email}</span>
            </div>
            <div {...props(styles.row)}>
              <span {...props(styles.key)}>Host calls itself</span>
              <span {...props(styles.value)}>{lookup.hostName}</span>
            </div>
            <div {...props(styles.row)}>
              <span {...props(styles.key)}>Fingerprint</span>
              <span {...props(styles.value, styles.mono)}>{lookup.fingerprint}</span>
            </div>
          </div>
          {error !== undefined && (
            <p role="alert" {...props(intent.danger, styles.error)}>
              {error}
            </p>
          )}
          <div {...props(styles.actions)}>
            <Button disabled={pending} onClick={() => void decide(lookup, "deny")}>
              Deny
            </Button>
            <Button
              variant="solid"
              tone="primary"
              loading={pending}
              onClick={() => void decide(lookup, "approve")}
            >
              Approve
            </Button>
          </div>
        </WebPage>
      );
    }
    case "approved":
      return (
        <WebPage
          title="Host Approved"
          description="The host finishes linking on its own. You can close this page."
        />
      );
    case "denied":
      return (
        <WebPage
          title="Request Denied"
          description="Nothing was linked. The host will report that the request was declined."
        />
      );
    default: {
      const _exhaustive: never = step;

      return _exhaustive;
    }
  }
}

function LinkBoundary({ config }: { readonly config: AccountConfig }): ReactElement {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const redirectUrl = new URL(location.pathname, location.href).href;

  if (!isLoaded) {
    return (
      <WebPage>
        <p role="status" {...props(styles.status)}>
          <ClerkLoading>
            <Spinner />
            <span {...props(srOnly)}>Loading sign-in</span>
          </ClerkLoading>
        </p>
        <ClerkFailed>
          <p role="alert" {...props(styles.status)}>
            Couldn't load sign-in.
          </p>
          <Button variant="outline" onClick={() => location.reload()}>
            Reload
          </Button>
        </ClerkFailed>
      </WebPage>
    );
  }

  if (!isSignedIn || userId == null) {
    return (
      <WebPage title="Link a Host" description="Sign in to approve a host for your account.">
        <AccountScope>
          <SignIn
            routing="hash"
            withSignUp
            forceRedirectUrl={redirectUrl}
            signUpForceRedirectUrl={redirectUrl}
          />
        </AccountScope>
      </WebPage>
    );
  }

  return <LinkFlow key={userId} config={config} />;
}

export function LinkScreen({ config }: { readonly config: AccountConfig }): ReactElement {
  return (
    <ClerkProvider
      publishableKey={config.publishableKey}
      telemetry={false}
      appearance={accountAppearance}
    >
      <LinkBoundary config={config} />
    </ClerkProvider>
  );
}
