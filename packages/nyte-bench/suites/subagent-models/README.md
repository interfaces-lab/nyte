# Subagent models

Whether a subagent starts on the model the user named the way people say it ("opus 5.5", "sol 6.1", "astra") in one round, with no failed `task` call. Each subagent gets a scripted reply instead of reaching its model, so the case measures only the chat's call: the model it resolves to and the rounds it takes.

| Case | The user says | The subagent must run on |
| --- | --- | --- |
| `model-opus` | opus 5.5 | `anthropic/claude-opus-5-5` |
| `model-sonnet` | sonnet 5.5 | `anthropic/claude-sonnet-5-5` |
| `model-haiku` | haiku 5.5 | `anthropic/claude-haiku-5-5` |
| `model-sol` | sol 6.1 | `openai-codex/gpt-6.1-sol` |
| `model-astra` | astra | `openai-codex/gpt-6-astra` |

The run signs in to every provider a case's subagent model needs, as well as the lineup's.
