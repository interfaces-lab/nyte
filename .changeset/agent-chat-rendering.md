---
"@nyte-ai/desktop": patch
---

A chat does far less rendering work while several agents run. An agent's update redraws only its own card instead of the whole conversation and composer, and streamed output reaches the screen at most once a frame. A lone agent's card keeps its spinner when a second agent joins, the Agents tray shows its frame before the agent's transcript loads, and closing a tray no longer makes the Agents pill jump.
