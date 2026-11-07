# File structure grammars

`manifest.json` pins the npm archives, archive integrity, WASM hashes, ABI versions and licences.
The worker fetches one grammar and its fold/symbol queries for the resolved editor language.
It does not use these assets for highlighting.

From the repository root:

```sh
node scripts/editor-grammars.mjs
node scripts/editor-grammars.mjs --write
node scripts/editor-grammars.mjs --refresh
```

The default verifies the installed runtime, vendored bytes, licences and generated registries.
`--write` regenerates the profiles, asset URLs and notice. `--refresh` also downloads the pinned
archives, checks their integrity and extracts their WASM and licence files. Query changes are
source changes, not part of an upstream refresh.

The Markdown WASM comes from the immutable OpenTUI package recorded in the manifest. Its source
configuration points to tree-sitter-markdown v0.5.1. OpenTUI uses the separate markdown_inline
grammar for inline highlighting injections. These queries read headings and block structure
from the block grammar alone; they do not parse inline content or fenced-language injections.
Both the grammar's and distributor's MIT licences are retained.

The app and desktop builds emit `NOTICE.txt`, the manifest and every licence under
`assets/file-structure/`. Grammar/query URLs use `?url&no-inline`; importing the registry does
not fetch those files. The worker owns the runtime, parser, queries and trees.
