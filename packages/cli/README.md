# nyte-ai

`nyte-ai` installs the `nyte` command, the terminal client for Nyte.

Run it without installing:

```sh
npx nyte-ai
```

Or install it globally:

```sh
npm install --global nyte-ai
nyte
```

The npm package downloads the matching release from
[`interfaces-lab/nyte`](https://github.com/interfaces-lab/nyte), verifies its SHA-256 checksum,
and caches the native executable under `~/.nyte/bin`. Set `NYTE_BIN_DIR` to choose another cache
directory.
