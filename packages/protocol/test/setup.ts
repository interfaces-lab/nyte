import { dev } from "@nyte-ai/core";

if (process.env.NYTE_DEV === undefined) dev.off();
