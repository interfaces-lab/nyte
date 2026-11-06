import { Dialog } from "@base-ui/react/dialog";
import { create, props } from "@stylexjs/stylex";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useId, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { mergeStyleProps } from "./style.ts";
import type { StyledProps } from "./style.ts";
import { layer } from "./styles/schema.stylex.ts";
import { role } from "./styles/vars.stylex.ts";

// Mirrors motion.durationSlow and motion.easeOutQuint; Motion can't read CSS variables.
const MORPH_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;

// Mirrors motion.durationFast.
const FADE_TRANSITION = { duration: 0.1 } as const;

const MorphContext = createContext<{
  readonly open: boolean;
  readonly layoutId: string;
  readonly reduced: boolean;
} | null>(null);

const styles = create({
  trigger: { position: "relative" },
  raised: { zIndex: layer.dialog },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: role.bgScrim,
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    translate: "-50% -50%",
    zIndex: layer.dialog,
    outline: "none",
    color: role.contentPrimary,
  },
});

function useMorph() {
  const context = useContext(MorphContext);

  if (context === null) throw new Error("Morph parts require Morph.Root.");

  return context;
}

function MorphRoot(input: Dialog.Root.Props & { readonly open: boolean }): ReactElement {
  const id = useId();
  const reduced = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);

  return (
    <MorphContext value={{ open: input.open, layoutId: id, reduced }}>
      <Dialog.Root {...input} />
    </MorphContext>
  );
}

function readReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeReducedMotion(notify: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);

  return () => query.removeEventListener("change", notify);
}

function MorphTrigger({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Trigger.Props>): ReactElement {
  const context = useMorph();
  const [animating, setAnimating] = useState(false);

  return (
    <Dialog.Trigger
      {...rest}
      {...mergeStyleProps(
        props(styles.trigger, (context.open || animating) && styles.raised, xstyle),
        className,
        style,
      )}
      render={
        <motion.button
          layoutId={context.reduced ? undefined : context.layoutId}
          layoutCrossfade={false}
          transition={MORPH_TRANSITION}
          onLayoutAnimationStart={() => setAnimating(true)}
          onLayoutAnimationComplete={() => setAnimating(false)}
        />
      }
    />
  );
}

function MorphPortal(input: Dialog.Portal.Props): ReactElement {
  const context = useMorph();

  return (
    <AnimatePresence>{context.open && <Dialog.Portal {...input} keepMounted />}</AnimatePresence>
  );
}

function MorphBackdrop({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Backdrop.Props>): ReactElement {
  return (
    <Dialog.Backdrop
      data-slot="morph-backdrop"
      {...rest}
      {...mergeStyleProps(props(styles.backdrop, xstyle), className, style)}
      render={
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE_TRANSITION}
        />
      }
    />
  );
}

function MorphPopup({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Popup.Props>): ReactElement {
  const context = useMorph();

  return (
    <Dialog.Popup
      data-slot="morph-popup"
      {...rest}
      {...mergeStyleProps(props(styles.popup, xstyle), className, style)}
      render={
        <motion.div
          layoutId={context.reduced ? undefined : context.layoutId}
          layoutCrossfade={false}
          layout={!context.reduced}
          initial={{ opacity: context.reduced ? 0 : 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={context.reduced ? FADE_TRANSITION : MORPH_TRANSITION}
        />
      }
    />
  );
}

function MorphClose({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Close.Props>): ReactElement {
  return <Dialog.Close {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

function MorphTitle({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Title.Props>): ReactElement {
  return <Dialog.Title {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

function MorphDescription({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Description.Props>): ReactElement {
  return <Dialog.Description {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

const morphParts = {
  Root: MorphRoot,
  Trigger: MorphTrigger,
  Portal: MorphPortal,
  Backdrop: MorphBackdrop,
  Popup: MorphPopup,
  Close: MorphClose,
  Title: MorphTitle,
  Description: MorphDescription,
};

export { morphParts as Morph };
