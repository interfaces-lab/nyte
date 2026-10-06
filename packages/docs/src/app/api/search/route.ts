import { createSearchAPI } from "fumadocs-core/search/server";
import { searchIndexes } from "~/lib/docs";

export const { GET } = createSearchAPI("advanced", { indexes: searchIndexes });
