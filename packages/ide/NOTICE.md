# Third-party notices

## Pierre

- Repository: https://github.com/pierrecomputer/pierre
- What: the file-type icons, their colours and the rules that map a file name to an icon are
  generated from `@pierre/trees` by the file-icon generator script. The navigator's row
  anatomy and git colouring follow the same package's stylesheet. The syntax colours come from
  `@pierre/theme` by way of Nyte's own tokens. The struct-of-arrays file store follows the
  approach of Pierre's path store; no code was copied from it.

License: Apache License 2.0, reproduced in the appendix of the repository's third-party notices.
Copyright 2025 Pierre Computer Company.

## libghostty-vt

- Repository: https://github.com/ghostty-org/ghostty
- Version: 1.0.1, the signed release XCFramework, pinned by checksum in the package manifest.
- What: terminal parsing and state for the terminal pane. Rendering and the PTY are Nyte's own.

```
MIT License

Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors

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

## md4c

- Repository: https://github.com/mity/md4c
- Version: 0.6.0 (tag `v0.6.0`), `md4c.c` and `md4c.h` vendored unmodified as the `Md4c` C target.
- What: the Markdown parser behind `MarkdownView` and `Prose`.

```
The MIT License (MIT)

Copyright © 2016-2026 Martin Mitáš

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the “Software”),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

## BeautifulMermaid (beautiful-mermaid-swift)

- Repository: https://github.com/lukilabs/beautiful-mermaid-swift
- Version: 1.0.4, a Swift package dependency pinned exactly in the manifest.
- What: parses, lays out and draws Mermaid diagrams for the `NyteDiagrams` block provider.

```
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

## elk-swift

- Repository: https://github.com/lukilabs/elk-swift
- Version: 1.0.2, resolved as a dependency of beautiful-mermaid-swift.
- What: the graph layout engine BeautifulMermaid uses. It is used unmodified, as a dependency;
  its source is the repository above.

License: Eclipse Public License 2.0 (EPL-2.0), https://www.eclipse.org/legal/epl-2.0/.
