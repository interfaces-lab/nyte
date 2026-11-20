import { SdkError } from "@nyte-ai/sdk";
import type { Json } from "@nyte-ai/sdk";

type Run = (name: string, input: Json) => Json;

let serving: Run | undefined;

/** The app's named actions, run by the shell on screen. */
export const appActions = {
  /**
   * Runs the action `name` with `input` and returns its result. Throws `unavailable` while no
   * shell is on screen or the action has nothing to act on, `not_supported` for a name the app
   * does not have, and `invalid` for input the action does not take.
   */
  run(name: string, input: Json): Json {
    if (serving === undefined) throw new SdkError("unavailable", "The app is still starting.");

    return serving(name, input);
  },
  /** Makes `run` the way actions run until the returned function is called. */
  serve(run: Run): () => void {
    serving = run;

    return () => {
      if (serving === run) serving = undefined;
    };
  },
};
