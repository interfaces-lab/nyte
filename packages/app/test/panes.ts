import { WindowDrafts } from "../src/chat/composer/drafts.ts";
import type { StorageArea } from "../src/lib/storage.ts";
import { PaneController } from "../src/panes/pane-controller.ts";
import { createSinglePane } from "../src/panes/pane-layout.ts";
import { SessionViewStateStore } from "../src/panes/session-view-state.ts";

/** One window tab's panes with no window around them: each layout change lands as it is. */
export function tabPanes(drafts?: {
  readonly storage: StorageArea;
  readonly storageKey: string;
}): PaneController {
  return new PaneController({
    initialLayout: createSinglePane(),
    route: (_current, next) => next,
    viewState: new SessionViewStateStore(new WindowDrafts(drafts), ""),
  });
}
