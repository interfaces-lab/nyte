import { publishDeferred } from "../lib/deferred.tsx";
import { ProjectPage } from "./project-page.tsx";

/** A project's page and its editor. They show only once a project is opened, so they load apart from startup. */
export const projectsRuntime = { ProjectPage };

publishDeferred("projects", projectsRuntime);
