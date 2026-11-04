# Examples

Shell scripts that run one `nyte` prompt and return its exit status. Copy and adapt them as you
like. They don't change your shell settings.

| Script | What it does |
| --- | --- |
| [ask.sh](ask.sh) | Passes its arguments to `nyte` as the prompt, without shell evaluation |
| [prompt-file.sh](prompt-file.sh) | Reads the prompt from a UTF-8 text file through stdin |

## Run them

Put `nyte` on your `PATH` and sign in with `nyte login`. Then run the scripts from the folder you
want Nyte to inspect. Replace `/path/to/docs` with the directory that holds this guide. The
[guide](../README.md) lists where each install puts it.

```sh
sh /path/to/docs/examples/ask.sh "Summarize this project's README"
sh /path/to/docs/examples/prompt-file.sh ./prompt.txt
```
