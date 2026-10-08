export const appName = "Nyte";

/* The model every example on the site uses. MDX code writes {{model}} or {{modelId}}. */
export const modelId = "gpt-6-luna";
export const model = `openai-codex/${modelId}`;
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "interfaces-lab",
  repo: "nyte",
  branch: "main",
};

export const siteUrl = "https://nyte.sh";
export const siteTitle = "Nyte: the agent core, built like git";
export const siteDescription =
  "An open source agent core built like git. Sessions live in SQLite on your laptop or Postgres at the edge, and outlive the process that started them.";
export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
