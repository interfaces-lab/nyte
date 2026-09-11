# OpenTUI 0.5.11 fixes

## Rectangle clipping

OpenTUI 0.5.11 passes negative rectangle origins to the unsigned native
`bufferFillRect` API, losing the visible portion. The patch clips to the buffer
in both Bun and Node bundles; native viewport clipping still applies.
This replaces Nyte's scroll-time diff color filtering.

Remove the patch when [upstream](https://github.com/anomalyco/opentui/blob/main/packages/core/src/buffer.ts)
handles offscreen rectangles. Verify partially visible negative origins,
fully offscreen rectangles, right/bottom overflow, and native scissor clipping
in both Bun and Node before removing this part of the patch.

## EditBuffer text reads

`EditBuffer.getText()` allocates a 1 MiB output buffer on every read, even when
empty, and truncates larger documents. Both bundles now use the existing public
`textBufferGetByteSize(textBufferPtr)` query and return early for zero bytes.
The native query is O(1): rope metrics sum segment byte ranges plus newlines,
not cell widths. Virtual extmarks do not change the stored text payload.
The FFI's separate payload copy remains unchanged.

Native-backed checks on Bun 1.4.2 and Node 26.8.1 with `--experimental-ffi`
measured output allocations of zero bytes for empty text, 5 bytes for `hello`,
and 34 bytes for a mixed Unicode fixture, instead of 1,048,576 bytes each.
Exact UTF-8 payloads, a 1,048,587-byte roundtrip, virtual extmarks, undo/redo,
and rectangle clipping passed in both runtimes. Incremental combining-mark
cursor/display behavior remains broken upstream; this patch does not fix it.

Remove this part when upstream uses byte-sized reads without an empty allocation.
Recheck empty, short, multiline, combining, emoji, virtual-mark, and over-1-MiB
payloads in both runtimes before removing it.
