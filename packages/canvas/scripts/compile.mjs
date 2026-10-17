/**
 * Compiles one canvas, `{ source, files }` as JSON on stdin, and prints the
 * compiler's outcome as JSON, for a test in a client package, which may not
 * import the compiler itself.
 */
import { text } from "node:stream/consumers";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";

const { source, files } = JSON.parse(await text(process.stdin));

process.stdout.write(JSON.stringify(await compileCanvas(source, files)));
