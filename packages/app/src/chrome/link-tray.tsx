/**
 * Linking this Mac to a Nyte account, one step at a time. The tray grows from
 * whatever opened it and changes height with each step, so moving forward is
 * visible. Its owner keeps it mounted until it closes, even once the Mac is
 * linked; managing a linked Mac lives in Environments, never here.
 */
import { Button } from "@nyte-ai/ui/button";
import { Popover } from "@nyte-ai/ui/popover";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { SwitchField } from "@nyte-ai/ui/switch";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ConnectBridge } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import {
  linkFailure,
  noticeNote,
  unavailableDetail,
  useConnectAction,
  useConnectView,
} from "./connect-view.ts";

const styles = create({
  popup: { width: 300, padding: 0 },
  morph: { overflow: "hidden" },
  step: { display: "flex", flexDirection: "column", gap: 12, padding: 16 },
  copy: { display: "flex", flexDirection: "column", gap: 4 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontLg,
    fontWeight: 600,
    lineHeight: type.leadingLg,
  },
  body: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textWrap: "pretty",
  },
  progress: { display: "flex", alignItems: "center", gap: 8, color: role.contentPrimary },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  switch: { paddingInline: 12, paddingBlock: 10 },
});

const EASE = [0.32, 0.72, 0, 1] as const;

/** Follows its content's height, so a step change reads as the tray growing or shrinking. */
function Morph({ children }: { readonly children: ReactNode }): ReactElement {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const node = inner.current;

    if (node === null) return undefined;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height: height ?? "auto" }}
      transition={reducedMotion === true ? { duration: 0 } : { duration: 0.32, ease: EASE }}
      {...props(styles.morph)}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

function Step({
  title,
  body,
  children,
  actions,
}: {
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.step)}>
      <div {...props(styles.copy)}>
        <Popover.Title render={<h3 />} xstyle={styles.title}>
          {title}
        </Popover.Title>
        {body !== undefined && <p {...props(styles.body)}>{body}</p>}
      </div>
      {children}
      <div {...props(styles.actions)}>{actions}</div>
    </div>
  );
}

function LinkSteps({
  connect,
  onClose,
}: {
  readonly connect: ConnectBridge;
  readonly onClose: () => void;
}): ReactElement {
  const state = useConnectView(connect, true);
  const link = useConnectAction(() => connect.link(), "Couldn’t link this Mac");
  const cancel = useConnectAction(() => connect.cancel(), "Couldn’t stop linking");

  const setEnabled = useConnectAction(
    (enabled: boolean) => connect.setEnabled({ enabled }),
    "Couldn’t change remote access",
  );

  const view = state.data;
  const close = <Button onClick={onClose}>Close</Button>;

  if (view === undefined) {
    return state.isError ? (
      <Step title="Nyte account" body={errorMessage(state.error)} actions={close} />
    ) : (
      <div {...props(styles.step)}>
        <Spinner />
      </div>
    );
  }

  if (view.kind === "unavailable") {
    return <Step title="Nyte account" body={unavailableDetail(view.reason)} actions={close} />;
  }

  if (view.kind === "linked") {
    return (
      <Step
        title={`${view.environment.name} is linked`}
        body={`Open Nyte on your iPhone and sign in as ${view.owner.label}.`}
        actions={
          <Button variant="solid" tone="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div {...props(settingsPatterns.group)}>
          <SwitchField
            xstyle={styles.switch}
            label="Remote Access"
            checked={setEnabled.isPending ? setEnabled.variables : view.enabled}
            disabled={setEnabled.isPending}
            onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
          />
        </div>
      </Step>
    );
  }

  const { account, linking } = view;

  if (linking.kind === "waiting_for_account" || linking.kind === "linking") {
    return (
      <Step
        title="Link This Mac"
        actions={
          <Button loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel
          </Button>
        }
      >
        <span role="status" {...props(styles.progress)}>
          <Spinner />
          {linking.kind === "linking" ? "Linking this Mac…" : "Finish signing in."}
        </span>
      </Step>
    );
  }

  const notice = noticeNote(view.notice);
  const failure = linking.kind === "failed" ? linkFailure(linking.reason) : undefined;

  return (
    <Step
      title="Reach this Mac from your iPhone"
      body="Sign in to a Nyte account here and on your iPhone. Nothing else in Nyte needs one."
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            Not Now
          </Button>
          <Button
            variant="solid"
            tone="primary"
            loading={link.isPending}
            onClick={() => link.mutate()}
          >
            {account.kind === "signed_in" ? "Link This Mac" : "Sign In and Link…"}
          </Button>
        </>
      }
    >
      {notice !== undefined && <p {...props(styles.body)}>{notice}</p>}
      {failure !== undefined && (
        <p role="alert" {...props(intent.danger, styles.body)}>
          {failure}
        </p>
      )}
    </Step>
  );
}

export function LinkTray({
  connect,
  open,
  onOpenChange,
  side,
  trigger,
}: {
  readonly connect: ConnectBridge;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side: "top" | "bottom";
  readonly trigger: ReactElement;
}): ReactElement {
  return (
    <Popover.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side={side} align="end" sideOffset={6}>
          <Popover.Popup xstyle={styles.popup}>
            <Morph>
              <LinkSteps connect={connect} onClose={() => onOpenChange(false)} />
            </Morph>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
