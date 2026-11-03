import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { verifySignature } from "./signature.ts";

const releaseUrl = "https://api.github.com/repos/ghostty-org/ghostty/releases/tags/tip";

const artifact = "ghostty-vt.wasm";

const root = new URL("../", import.meta.url);

const release = await readRelease();

const wasmResponse = await download(release.assets.get(artifact));

const wasm = new Uint8Array(await wasmResponse.arrayBuffer());

const minisig = await (await download(release.assets.get(`${artifact}.minisig`))).text();

const trustedComment = verifySignature(wasm, minisig);

if (!trustedComment.split("\t").includes(`file:${artifact}`)) {
  throw new Error(`signature is not for ${artifact}: ${trustedComment}`);
}

const sha256 = createHash("sha256").update(wasm).digest("hex");

const published = new Uint8Array(
  await (
    await download(`https://tip.files.ghostty.org/${release.commit}/${artifact}`)
  ).arrayBuffer(),
);

if (createHash("sha256").update(published).digest("hex") !== sha256) {
  throw new Error(`the tip ${artifact} is not the build Ghostty published for ${release.commit}`);
}

await writeFile(new URL(artifact, root), wasm);

await writeFile(new URL(`${artifact}.minisig`, root), minisig);

await writeFile(
  new URL("pin.json", root),
  `${JSON.stringify({ commit: release.commit, sha256 }, null, 2)}\n`,
);

console.log(`pinned ${artifact} from ${release.commit} (sha256 ${sha256})`);

async function readRelease() {
  const response = await fetch(releaseUrl, { headers: { accept: "application/vnd.github+json" } });

  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${releaseUrl}`);
  const body: unknown = await response.json();

  if (!(body instanceof Object) || !("target_commitish" in body) || !("assets" in body)) {
    throw new Error("tip release metadata is missing target_commitish or assets");
  }

  const commit = String(body.target_commitish);
  const assets: unknown[] = Array.isArray(body.assets) ? body.assets : [];

  if (!/^[0-9a-f]{40}$/u.test(commit))
    throw new Error(`tip release target ${commit} is not a commit`);

  return {
    commit,
    assets: new Map(
      assets.flatMap((asset) =>
        asset instanceof Object && "name" in asset && "browser_download_url" in asset
          ? [[String(asset.name), String(asset.browser_download_url)] as const]
          : [],
      ),
    ),
  };
}

async function download(url: string | undefined) {
  if (url === undefined) throw new Error(`tip release has no ${artifact} asset or signature`);
  const response = await fetch(url);

  if (!response.ok) throw new Error(`${url} answered ${response.status}`);

  return response;
}
