import { text } from "node:stream/consumers";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";

const { source, files } = JSON.parse(await text(process.stdin));

process.stdout.write(JSON.stringify(await compileCanvas(source, files)));
