import { NyteWireError, type NyteClient } from "@nyte-ai/client";
import { waitingCall, type SessionState, type SessionUpdate } from "@nyte-ai/client";
import {
  acceptsSelectionReply,
  type ModelInfo,
  type ModelRef,
  type OperationInput,
  type ReplyOutcome,
  type SelectionReply,
  type SessionId,
} from "@nyte-ai/protocol";
import { randomUUID } from "expo-crypto";
// oxlint-disable-next-line no-restricted-imports -- the session observer lifecycle follows its target
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { describeHostError } from "../connection/connection.ts";
import { observeSession } from "./session-observers.ts";

export type UserContent = OperationInput<"messages.send">["content"];

export function useRemoteChat(client: NyteClient, activeSessionId: SessionId | undefined) {
  const target = useMemo(() => ({ client, sessionId: activeSessionId }), [client, activeSessionId]);
  const activeTarget = useRef<typeof target | undefined>(undefined);

  const [view, setView] = useState<
    { target: typeof target; state?: SessionState; error?: string } | undefined
  >(undefined);

  const [sendError, setSendError] = useState<
    { target: typeof target; message: string } | undefined
  >(undefined);

  const submission = useRef<
    { target: typeof target; serializedContent: string; key: string } | undefined
  >(undefined);

  const inFlight = useRef<typeof submission.current>(undefined);
  const [sendingTarget, setSendingTarget] = useState<typeof target | undefined>(undefined);
  const configuring = useRef<{ target: typeof target; model: ModelInfo } | undefined>(undefined);

  const [modelSelection, setModelSelection] = useState<
    | { target: typeof target; kind: "saving" | "accepted"; model: ModelInfo }
    | { target: typeof target; kind: "failed"; message: string }
    | undefined
  >(undefined);

  const observed = useRef<
    ({ target: typeof target } & ReturnType<typeof observeSession>) | undefined
  >(undefined);

  const replying = useRef<{ target: typeof target; waitId: string } | undefined>(undefined);

  const answered = useRef<
    | {
        target: typeof target;
        waitId: string;
        outcome: ReplyOutcome;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    activeTarget.current = target;
    submission.current = undefined;
    inFlight.current = undefined;
    replying.current = undefined;
    answered.current = undefined;
    configuring.current = undefined;
    const sessionId = target.sessionId;
    let observer: ReturnType<typeof observeSession> | undefined;
    let unsubscribe: (() => void) | undefined;

    const disconnect = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      observer?.close();
      observer = undefined;

      if (observed.current?.target === target) observed.current = undefined;
    };

    const connect = () => {
      if (observer !== undefined || sessionId === undefined) return;

      const next = observeSession(target.client, sessionId, (cause) => {
        if (observer !== next) return;
        setView((previous) => ({
          target,
          state: previous?.target === target ? previous.state : undefined,
          error: describeHostError(cause),
        }));

        if (
          cause instanceof NyteWireError &&
          (cause.code === "unauthorized" ||
            cause.code === "forbidden" ||
            cause.code === "unknown_session")
        )
          disconnect();
      });

      observer = next;
      observed.current = { target, ...next };

      const updateView = (update: SessionUpdate) => {
        if (observer !== next) return;
        setView({ target, state: update.state });

        if (update.selectedVersion === next.selection.version) {
          setModelSelection((current) =>
            current?.target === target && current.kind === "accepted" ? undefined : current,
          );
        }
      };

      unsubscribe = next.observer.subscribe(updateView);

      if (next.observer.state !== undefined) {
        updateView({ kind: "snapshot", state: next.observer.state, selectedVersion: undefined });
      }
    };

    if (AppState.currentState === "active" || AppState.currentState === null) connect();

    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") connect();
      else disconnect();
    });

    return () => {
      disconnect();
      subscription.remove();

      if (activeTarget.current === target) activeTarget.current = undefined;
    };
  }, [target]);

  const state = view?.target === target ? view.state : undefined;

  const streamingText = useMemo(() => {
    let text = "";

    for (const part of state?.overlay ?? []) {
      if (part.kind === "text") text += part.text;
    }

    return text;
  }, [state?.overlay]);

  const send = useCallback(
    async (content: UserContent): Promise<boolean> => {
      const sessionId = target.sessionId;

      const empty = Array.isArray(content)
        ? !content.some((part) =>
            part.type === "text" ? part.text.trim() !== "" : part.data !== "",
          )
        : content.trim() === "";

      if (
        activeTarget.current !== target ||
        sessionId === undefined ||
        empty ||
        inFlight.current !== undefined ||
        configuring.current !== undefined
      ) {
        return false;
      }

      // A lost response may hide an accepted send. Retrying that draft must reuse its receipt key.
      // Snapshot only when Send is pressed, including photo bytes without retaining mutable parts.
      const serializedContent = JSON.stringify(content);
      const previous = submission.current;

      const attempt =
        previous?.target === target && previous.serializedContent === serializedContent
          ? previous
          : { target, serializedContent, key: randomUUID() };

      submission.current = attempt;
      inFlight.current = attempt;
      setSendingTarget(target);
      setSendError(undefined);

      try {
        await client.messages.send({ sessionId, content, key: attempt.key });

        if (submission.current === attempt) submission.current = undefined;

        return activeTarget.current === target;
      } catch (cause) {
        if (activeTarget.current === target) {
          setSendError({
            target,
            message:
              cause instanceof NyteWireError && cause.code === "payload_too_large"
                ? "This message is too large for your Mac. Remove a photo or shorten the text."
                : describeHostError(cause),
          });
        }

        return false;
      } finally {
        if (inFlight.current === attempt) {
          inFlight.current = undefined;
          setSendingTarget(undefined);
        }
      }
    },
    [client, target],
  );

  const waiting = state === undefined ? undefined : waitingCall(state);

  const selectModel = useCallback(
    async (model: ModelInfo): Promise<boolean> => {
      const live = observed.current;
      const sessionId = target.sessionId;

      if (
        activeTarget.current !== target ||
        live?.target !== target ||
        sessionId === undefined ||
        configuring.current !== undefined
      )
        return false;
      const attempt = { target, model };
      configuring.current = attempt;
      live.selection.version += 1;
      setModelSelection({ ...attempt, kind: "saving" });

      try {
        const outcome = await client.sessions.configure({
          sessionId,
          model: { provider: model.provider, id: model.id },
        });

        if (activeTarget.current !== target) return false;

        if (observed.current?.target === target) observed.current.selection.version += 1;

        if (outcome.kind !== "queued") {
          setModelSelection({
            target,
            kind: "failed",
            message:
              outcome.kind === "unknown_model"
                ? "That model is no longer available on your Mac. Refresh the model list."
                : "Your Mac couldn't apply that model choice.",
          });

          return false;
        }

        setModelSelection({ ...attempt, kind: "accepted" });

        return true;
      } catch (cause) {
        if (activeTarget.current === target) {
          if (observed.current?.target === target) observed.current.selection.version += 1;
          setModelSelection({ target, kind: "failed", message: describeHostError(cause) });
        }

        return false;
      } finally {
        if (configuring.current === attempt) configuring.current = undefined;

        // A lost response can hide a queued choice. Read selected inputs without changing the run.
        if (activeTarget.current === target && observed.current?.target === target)
          observed.current.observer.refresh();
      }
    },
    [client, target],
  );

  const reply = useCallback(
    async (answer: SelectionReply): Promise<ReplyOutcome | undefined> => {
      const live = observed.current;

      const current =
        live?.observer.state === undefined ? undefined : waitingCall(live.observer.state);

      if (
        activeTarget.current !== target ||
        live?.target !== target ||
        waiting === undefined ||
        current === undefined ||
        current.sessionId !== waiting.sessionId ||
        current.runId !== waiting.runId ||
        current.callId !== waiting.callId ||
        current.waitId !== waiting.waitId ||
        replying.current !== undefined ||
        !acceptsSelectionReply(waiting.selection, answer)
      )
        return undefined;
      const previous = answered.current;

      if (previous?.target === target && previous.waitId === waiting.waitId)
        return previous.outcome;
      const attempt = { target, waitId: waiting.waitId };
      replying.current = attempt;

      try {
        const outcome = await client.runs.reply({
          sessionId: waiting.sessionId,
          runId: waiting.runId,
          callId: waiting.callId,
          waitId: waiting.waitId,
          reply:
            answer.other === undefined
              ? { choices: [...answer.choices] }
              : { choices: [...answer.choices], other: answer.other.trim() },
        });

        if (activeTarget.current === target) {
          answered.current = { ...attempt, outcome };

          // Core retries the new snapshot; stopping observation never undoes an accepted answer.
          if (observed.current?.target === target)
            void observed.current.observer.resync().catch(() => undefined);
        }

        return outcome;
      } catch {
        // The question owns reply failure feedback; keep it out of the composer.
        return undefined;
      } finally {
        if (replying.current === attempt) replying.current = undefined;
      }
    },
    [client, target, waiting],
  );

  const stop = async (): Promise<void> => {
    if (activeSessionId === undefined || state?.run === undefined) return;

    try {
      await client.runs.abort({ sessionId: activeSessionId, runId: state.run.runId });
    } catch (cause) {
      if (activeTarget.current === target) {
        setView((current) => ({
          target,
          state: current?.target === target ? current.state : undefined,
          error: describeHostError(cause),
        }));
      }
    }
  };

  const selection = modelSelection?.target === target ? modelSelection : undefined;

  const selectedModel: ModelRef | undefined =
    selection?.kind === "accepted"
      ? selection.model
      : (state?.info.config.model ?? state?.config.model);

  return {
    state,
    streamingText,
    sending: sendingTarget === target,
    error:
      sendError?.target === target
        ? sendError.message
        : view?.target === target
          ? view.error
          : undefined,
    send,
    reply,
    selectedModel,
    selectingModel: selection?.kind === "saving",
    modelError: selection?.kind === "failed" ? selection.message : undefined,
    selectModel,
    stop,
  };
}
