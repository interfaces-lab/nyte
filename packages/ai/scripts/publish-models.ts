#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const catalogDir = join(packageRoot, "catalog");

const repositoryRoot = join(packageRoot, "..", "..");

function uploadModelCatalog(filename: string): Promise<void> {
  const path = join(catalogDir, filename);

  return new Promise((resolve, reject) => {
    const upload = spawn(
      "npx",
      [
        "wrangler@4",
        "r2",
        "object",
        "put",
        `nyte-models/${filename}`,
        "--file",
        path,
        "--content-type",
        "application/json",
        "--cache-control",
        "public, max-age=300",
        "--remote",
      ],
      { cwd: repositoryRoot, stdio: "inherit" },
    );

    upload.once("error", (error) => {
      reject(
        new Error(`Could not start the upload for ${filename}: ${error.message}`, { cause: error }),
      );
    });

    upload.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();

        return;
      }

      const status = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;

      reject(
        new Error(
          `Upload failed for ${filename} with ${status}. Log in with Wrangler or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.`,
        ),
      );
    });
  });
}

async function publishModels(): Promise<void> {
  const filenames = (await readdir(catalogDir))
    .filter((filename) => filename.endsWith(".json"))
    .sort();

  if (filenames.length === 0) {
    throw new Error(`No model catalogs found in ${catalogDir}. Run models:generate first.`);
  }

  for (const filename of filenames) {
    console.log(`Uploading ${filename}`);
    await uploadModelCatalog(filename);
  }

  console.log(`Published ${String(filenames.length)} model catalogs to nyte-models`);
}

publishModels().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
