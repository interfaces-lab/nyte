# @nyte-ai/ios

## 0.0.23

### Patch Changes

- [#12](https://github.com/interfaces-lab/nyte/pull/12) [`b52f54a`](https://github.com/interfaces-lab/nyte/commit/b52f54aeb7dc5cd035d08306d07899b9f6085249) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Skills whose `description` is a folded or literal YAML block (`>` or `|`) now show their text instead of the symbol, and skill directories that are symlinks are discovered; links that are broken, point at a file or loop are skipped, and two links to one directory load it once. A running command's preview now updates at most every 80 ms while output streams, instead of on every chunk, and still shows the first output and the final tail at once. The session list sends only the rows that changed after its first frame, so `sessions.watch` on the wire is now a frame that clients read through the SDK. The iOS inbox's relative times stop updating while the inbox is hidden or the app is in the background, and refresh as soon as you return.
- Updated dependencies [[`b52f54a`](https://github.com/interfaces-lab/nyte/commit/b52f54aeb7dc5cd035d08306d07899b9f6085249)]:
  - @nyte-ai/schema@0.0.23
  - @nyte-ai/sdk@0.0.23
  - @nyte-ai/connect@0.0.0
  - @nyte-ai/plugin@0.0.23
  - @nyte-ai/canvas@0.0.0

## 0.0.22

### Patch Changes

- Updated dependencies []:
  - @nyte-ai/plugin@0.0.22
  - @nyte-ai/schema@0.0.22
  - @nyte-ai/sdk@0.0.22
  - @nyte-ai/connect@0.0.0
  - @nyte-ai/canvas@0.0.0

## 0.0.21

### Patch Changes

- Updated dependencies [[`d8467fb`](https://github.com/interfaces-lab/nyte/commit/d8467fbc7275dad7c1853da9fc4cc0e291e2466d)]:
  - @nyte-ai/schema@0.0.21
  - @nyte-ai/plugin@0.0.21
  - @nyte-ai/sdk@0.0.21
  - @nyte-ai/connect@0.0.0
  - @nyte-ai/canvas@0.0.0

## 0.0.20

### Patch Changes

- Updated dependencies [[`4e734dd`](https://github.com/interfaces-lab/nyte/commit/4e734ddc8e479059899bfed983d12a4f0fe5c95b)]:
  - @nyte-ai/schema@0.0.20
  - @nyte-ai/plugin@0.0.20
  - @nyte-ai/sdk@0.0.20
  - @nyte-ai/connect@0.0.0
  - @nyte-ai/canvas@0.0.0
