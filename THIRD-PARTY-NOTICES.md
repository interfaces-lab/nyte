# Third-party notices

Parts of this repository are ported from or derived from other projects. Every
ported file carries a `Based on <link>` header naming its exact source; those
headers are the authoritative per-file provenance. This file lists the upstream
projects and their licenses. The dependencies below include MIT, Apache-2.0,
the MCP client's licensing-transition notice, the SIL Open Font License for
the bundled typefaces, and the proprietary Iconists license used by Central
Icons.

MIT notices are reproduced in full under each entry. The Apache License 2.0
covers several entries, so its full text appears once in the appendix at the
end of this file and those entries reference it there.

## pi (`earendil-works/pi`)

- Repository: https://github.com/earendil-works/pi
- What: the agent loop, provider adapters, auth and OAuth flows, schema types,
  and assorted runtime utilities across `packages/ai`, `packages/core`,
  `packages/schema`, `packages/telemetry`, `packages/tui`, and
  `packages/plugin` are ported from pi and tracked against it. This is the
  large majority of the `Based on` headers in this repository.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Pierre

- Repository: https://github.com/pierrecomputer/pierre
- Packages: `@pierre/diffs` 1.3.1, `@pierre/trees` 1.0.0-beta.4, with
  `@pierre/theme` 2.0.0 and `@pierre/theming` 1.0.0 pulled transitively by the
  diff renderer.
- What: the desktop app uses `@pierre/diffs` as a lazy leaf renderer for
  unified patches and uses `@pierre/trees` only for its complete file-icon
  resolver and sprite. The TUI's palettes (`packages/tui/src/theme.ts`) take
  their colors from `@pierre/theme`'s roles and their diff row fills from
  `@pierre/diffs`' stylesheet. Nyte core remains the source of change, VCS,
  file, and session identity; Pierre does not own application state or the
  workbench composition.

License: Apache License 2.0, reproduced in the appendix below. Copyright 2025
Pierre Computer Company. The license text is also distributed in each package.

`@pierre/trees` includes the following upstream notice:

> This project includes some code derived from
> [@headless-tree/core](https://github.com/lukasbach/headless-tree). The initial
> version used `headless-tree` as the underlying tree implementation. Pierre
> later wrote its own core, while retaining ideas including drag and drop and
> the general list approach to rendering.

The corresponding license notice is:

```text
MIT License

Copyright (c) 2023 Lukas Bach

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Central Icons

- Homepage: https://iconists.co/central
- Packages: `@central-icons-react/round-outlined-radius-2-stroke-1.5` and
  `@central-icons-react/round-filled-radius-2-stroke-1.5` 1.1.318
- What: the desktop icon leaf maps Nyte semantic icon names to Central's React
  glyphs. No icon SVG source is copied into Nyte source files.

License: the proprietary Iconists License Agreement distributed as the
package's `LICENSE.md` and published at https://iconists.co/license. Its seat,
redistribution, extraction, and 300-icons-per-style terms apply.

## dnd kit

- Repository: https://github.com/clauderic/dnd-kit
- Package: `@dnd-kit/core` 6.3.1
- What: the desktop sidebar uses dnd kit for accessible session dragging,
  drag overlays, and pane drop targets. Nyte retains ownership of pane layout
  and drop-placement semantics.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2021, Claudéric Demers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Model Context Protocol TypeScript SDK

- Repository: https://github.com/modelcontextprotocol/typescript-sdk
- Package: `@modelcontextprotocol/client` 2.0.0
- What: Nyte's retired core MCP integration used this client. Current search
  requests use `packages/plugin/examples/web-search/mcp.ts` without the SDK.
  No SDK source was ported into Nyte.

License: the package declares MIT in `package.json`. Its distributed `LICENSE`
records the MCP project's transition to Apache License 2.0, with contributions
whose relicensing consent has not been obtained remaining under MIT. The
complete applicable license text is distributed with the installed package and
published in the package repository.

## OpenAI Codex (`openai/codex`)

- Repository: https://github.com/openai/codex
- What: the Codex compaction request handling in
  `packages/ai/src/api/openai-codex-responses.ts` is ported from the
  `codex-rs` compaction endpoint.

License: Apache License 2.0, reproduced in the appendix below. Upstream ships
no `NOTICE` file, so no additional attribution text is carried.

## OpenCode (`anomalyco/opencode`)

- Repository: https://github.com/anomalyco/opencode
- What: the TUI slash-command autocomplete (`packages/tui/src/slash.ts`), the
  keymap wiring (`packages/tui/src/keymap.ts`), the queued-prompt panel in
  `packages/tui/src/interactive.ts`, Up/Down over a wrapped draft
  (`packages/tui/src/prompt-history.ts`), and patch-hunk splitting in
  `packages/tui/src/format.ts` are ported from OpenCode. The SDK admission
  vocabulary (`steer`/`queue`, `wait`, opaque cursors) follows OpenCode's v2
  design, as does re-delivery: `messages.redeliver`
  (`packages/core/src/kernel/queue.ts`) follows OpenCode v2's inbox
  `steer`/`queue`/`cancel` trio, and enter on an empty composer sending the
  front of the queue (`packages/tui/src/pending-gutter.ts`,
  `packages/tui/src/interactive.ts`) is its `onEmptySubmit`. The rename
  plugin's context construction, prompt, model fallback, and output cleanup
  (`packages/plugin/examples/rename.ts`) port OpenCode v2. The web-search
  plugin set (`packages/plugin/examples/web-search/`) ports its Exa, Firecrawl,
  Parallel, and Tavily adapters, its stateless MCP `tools/call` transport and
  response bounds, its result and error vocabulary, and its arrangement of one
  plugin per provider from OpenCode v2.
- Core's ripgrep resolver and search adapter (`packages/core/src/ripgrep.ts`,
  `packages/core/src/ripgrep/binary.ts`) and filename search
  (`packages/core/src/file-search.ts`) adapt OpenCode v2's core implementation.
- The TUI selection handlers, clipboard adapter, pasted-text expansion, Mermaid
  renderer integration, queued-message editing, and local plugin reloads also
  adapt merged V2 PRs #45758, #41603, #39920, #41113, #44683, #39776, and #47388.
  Source functions retain upstream names; the source comments pin the merge commits.
- The desktop working indicator (`packages/desktop/src/renderer/src/components/spinner.tsx`)
  adapts OpenCode v2's pixel-grid spinner and opacity animations to React and StyleX.
- The 10 desktop scenarios in `packages/desktop/benchmark/` port OpenCode v2's
  startup, navigation, streaming, retained-memory, terminal, workspace-cycle,
  transport-reconnect, and Markdown-lifetime tests. Nyte runs them against the
  real Electron process tree and adds CPU, idle-wakeup, RSS, process-count, and
  macOS POWER measurements.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Beautiful Mermaid (`lukilabs/beautiful-mermaid`)

- Repository: https://github.com/lukilabs/beautiful-mermaid
- Package: `beautiful-mermaid` 1.1.3
- What: terminal Mermaid diagrams use its Unicode renderer. The docs also use
  its SVG renderer.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2026 Craft Docs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## T3 Code (`pingdotgg/t3code`)

- Repository: https://github.com/pingdotgg/t3code
- Homepage: https://t3.codes
- What: the demo desktop app (`packages/demo/desktop`) follows T3 Code's
  control-surface shape — agents in a sidebar, a conversation workspace, a
  shared composer, and settings behind a dialog.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Grok Build (`xai-org/grok-build`)

- Repository: https://github.com/xai-org/grok-build
- What: the TUI's startup appearance detection (`packages/tui/src/theme.ts`)
  ports the `env_appearance` module of `xai-grok-pager-render`; the spinner and
  status glyphs (`packages/tui/src/constants.ts`) port its `glyphs`. The slash
  dropdown's layout and selection behavior
  (`packages/tui/src/slash-autocomplete.ts`, `packages/tui/src/menu-list.ts`,
  `packages/tui/src/picker.ts`) and the slash command model
  (`packages/tui/src/slash.ts`) port `xai-grok-pager`. The demo CLI
  (`packages/demo/cli/src/tui.ts`) uses a reduced dark palette.
- All of the above are adaptations rather than copies: they are rewritten in
  TypeScript against OpenTUI, and the semantic roles, detection order, and
  fallbacks differ from upstream where Nyte's structure differs.

License: Apache License 2.0, reproduced in the appendix below. Copyright
2023-2026 SpaceXAI. Upstream ships no `NOTICE` file, so no additional
attribution text is carried.

## Honk (`interfaces-lab/honk`)

- Repository: https://github.com/interfaces-lab/honk
- What: the desktop app's dense vertical sidebar, model-selection structure,
  work-detail controls, quiet grouped-work presentation, shared scrollport
  styling, StyleX layout schema, and right-side Changes workbench adapt Honk's
  interface structure to Nyte's SDK and TanStack Query projections.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.
Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## EasyList and EasyPrivacy

- Homepage: https://easylist.to
- What: `packages/desktop/scripts/build-adblock.mjs` fetches both lists at build
  time and serializes them into `resources/adblock.bin`, which the desktop app
  bundles as an extra resource for the browser panel. No list text is copied
  into Nyte source files. The engine that reads them is `@ghostery/adblocker`
  (MPL-2.0), used as an ordinary dependency.

License: dual-licensed under the GNU General Public License version 3 and the
Creative Commons Attribution-ShareAlike 3.0 Unported license, at the user's
choice. Nyte redistributes the lists under CC BY-SA 3.0.

## Inter (`rsms/inter`) and JetBrains Mono (`JetBrains/JetBrainsMono`)

- Repositories: https://github.com/rsms/inter,
  https://github.com/JetBrains/JetBrainsMono
- What: the desktop app bundles both as variable WOFF2 files through
  `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`,
  loaded from `packages/desktop/src/renderer/src/main.tsx`. Inter is the
  default interface face; JetBrains Mono is a selectable code face. The font
  files are redistributed unmodified.

License: SIL Open Font License, Version 1.1. Copyright 2016 The Inter Project
Authors; Copyright 2020 The JetBrains Mono Project Authors. The full license
text ships alongside each package as `LICENSE`.

## Fumadocs (`fuma-nama/fumadocs`)

- Repository: https://github.com/fuma-nama/fumadocs
- What: the docs site's Mermaid MDX component
  (`packages/docs/src/components/mdx/mermaid.tsx`) is ported from the Fumadocs
  docs app, adapted to render through `beautiful-mermaid` and to follow the
  active light or dark theme without a client-side re-render.

License: MIT, with the following notice:

```text
MIT License

Copyright (c) 2023 Fuma

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Appendix: Apache License 2.0

This is the license for Pierre, Grok Build, and OpenAI Codex above. Section 4
governs redistribution: it requires that recipients receive this license text,
that modified files say they were changed, and that copyright and attribution
notices are retained. The `Based on <link>` headers on each ported file carry
the change notice, and the copyright holders are named in their entries above.
None of these upstreams ships a `NOTICE` file, so section 4(d) adds nothing
here.

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
