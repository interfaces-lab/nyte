#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import { done, fail, seconds } from "./terminal.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const catalogDir = join(packageRoot, "catalog");

const repositoryRoot = join(packageRoot, "..", "..");

const concurrency = 6;

function uploadModelCatalog(filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = spawn(
      "wrangler",
      [
        "r2",
        "object",
        "put",
        `nyte-models/${filename}`,
        "--file",
        join(catalogDir, filename),
        "--content-type",
        "application/json",
        "--cache-control",
        "public, max-age=300",
        "--remote",
      ],
      { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";

    upload.stdout.on("data", (chunk: Buffer) => (output += chunk));
    upload.stderr.on("data", (chunk: Buffer) => (output += chunk));

    upload.once("error", (error) => {
      const hint =
        "code" in error && error.code === "ENOENT"
          ? "Wrangler is not installed. Run `mise install`."
          : error.message;

      reject(new Error(`Could not upload ${filename}: ${hint}`, { cause: error }));
    });

    upload.once("close", (code, signal) => {
      if (code === 0) {
        resolve();

        return;
      }

      const status = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;

      reject(
        new Error(
          [
            `Upload failed for ${filename} with ${status}.`,
            styleText("dim", output.trim()),
            "Log in with `wrangler login` or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.",
          ].join("\n\n"),
        ),
      );
    });
  });
}

async function publishModels(): Promise<void> {
  const startedAt = performance.now();
  const filenames = (await readdir(catalogDir))
    .filter((filename) => filename.endsWith(".json"))
    .sort();

  if (filenames.length === 0) {
    throw new Error(`No model catalogs found in ${catalogDir}. Run models:generate first.`);
  }

  const width = String(filenames.length).length;
  const nameWidth = Math.max(...filenames.map((filename) => filename.length));
  const pending = [...filenames];
  let uploaded = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    for (let filename = pending.shift(); filename && !failed; filename = pending.shift()) {
      try {
        await uploadModelCatalog(filename);
      } catch (error) {
        failed = true;

        throw error;
      }

      uploaded += 1;
      done(filename, `${String(uploaded).padStart(width)}/${filenames.length}`, nameWidth);
    }
  };

  const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = results.find((result) => result.status === "rejected");

  if (failure) throw failure.reason;

  console.log("");
  done(`Published ${filenames.length} catalogs to nyte-models`, seconds(startedAt));
}

publishModels().catch(fail);
