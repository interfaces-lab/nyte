/** Every specimen the Messages page draws, section by section. */
import type { Section } from "./build";
import { agentsSection } from "./sections/agents";
import { episodesSection } from "./sections/episodes";
import { historySection } from "./sections/history";
import { liveSection } from "./sections/live";
import { messagesSection } from "./sections/messages";
import { outcomesSection } from "./sections/outcomes";
import { rowsSection } from "./sections/rows";
import { statesSection } from "./sections/states";
import { toolsSection } from "./sections/tools";

export const SECTIONS: readonly Section[] = [
  messagesSection,
  episodesSection,
  toolsSection,
  agentsSection,
  statesSection,
  outcomesSection,
  historySection,
  liveSection,
  rowsSection,
];
