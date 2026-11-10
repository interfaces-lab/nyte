import { browserOperations } from "./browser.ts";
import { documentOperations } from "./documents.ts";
import { eventOperations } from "./events.ts";
import { fileOperations } from "./files.ts";
import { gitOperations } from "./git.ts";
import { githubOperations } from "./github.ts";
import { hostOperations, maintenanceOperations } from "./host.ts";
import { sessionOperations } from "./session.ts";
import { workspaceOperations } from "./workspace.ts";

export const operations = {
  ...hostOperations,
  ...eventOperations,
  ...sessionOperations,
  ...workspaceOperations,
  ...fileOperations,
  ...documentOperations,
  ...gitOperations,
  ...githubOperations,
  ...browserOperations,
  ...maintenanceOperations,
};
