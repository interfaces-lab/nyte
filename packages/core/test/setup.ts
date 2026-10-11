import { dev } from "../src/dev-log.ts";

if (process.env.NYTE_DEV === undefined) dev.off();
