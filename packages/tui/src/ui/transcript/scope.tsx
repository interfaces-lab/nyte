import type { JSX } from "@opentui/solid";
import { createContext, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import type { Task } from "../../lib/tasks.ts";
import type { TranscriptModel } from "../../model/transcript.ts";

export interface TranscriptScope {
  readonly model: Accessor<TranscriptModel>;
  readonly tasks: Accessor<readonly Task[]>;
}

const Scope = createContext<TranscriptScope>();

export function TranscriptScopeProvider(props: {
  readonly scope: TranscriptScope;
  readonly children: JSX.Element;
}): JSX.Element {
  return <Scope.Provider value={props.scope}>{props.children}</Scope.Provider>;
}

export function useTranscript(): TranscriptScope {
  const scope = useContext(Scope);

  if (scope === undefined) throw new Error("useTranscript() outside a <Transcript>");

  return scope;
}
