# Source examples

Run these from the workspace you want Nyte to inspect, after login and workspace
trust setup. Put `nyte` on `PATH`. Each script starts one prompt run and
returns Nyte's exit status. Neither script changes your shell settings.

- [ask.sh](ask.sh) passes prompt arguments without shell evaluation.
- [prompt-file.sh](prompt-file.sh) reads a prompt from a UTF-8 text file through stdin.

Replace `/path/to/docs` with this guide's installed directory:

```sh
sh /path/to/docs/examples/ask.sh "Summarize this project's README"
sh /path/to/docs/examples/prompt-file.sh ./prompt.txt
```

These are ordinary shell source files you can copy and adapt. See the
[usage guide](../usage.md) for setup and the [front door](../README.md) for locations.
