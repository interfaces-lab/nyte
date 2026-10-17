import { dev } from "../src/util/dev-log.ts";

if (process.env.NYTE_DEV === undefined) dev.off();
