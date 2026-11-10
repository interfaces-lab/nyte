import { checkoutDocsPath } from "@nyte-ai/service/docs";
import type { DocsSource } from "@nyte-ai/service/docs";

export default { kind: "folder", path: checkoutDocsPath() } satisfies DocsSource;
