import CoreServices
import Foundation
import os

final class FileEventStream {
    private final class Box {
        let handler: @Sendable ([URL]) -> Void
        init(_ handler: @escaping @Sendable ([URL]) -> Void) { self.handler = handler }
    }

    static let latency: CFTimeInterval = 0.3
    private let stream: FSEventStreamRef
    private let box: Unmanaged<Box>
    private let queue = DispatchQueue(label: "nyte.language.file-events")

    init?(paths: [String], handler: @escaping @Sendable ([URL]) -> Void) {
        let box = Unmanaged.passRetained(Box(handler))
        var context = FSEventStreamContext(version: 0, info: box.toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes
            | kFSEventStreamCreateFlagNoDefer)
        let callback: FSEventStreamCallback = { _, info, count, paths, _, _ in
            guard let info else { return }
            let names = Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as? [String] ?? []
            Unmanaged<Box>.fromOpaque(info).takeUnretainedValue().handler(names.prefix(count).map { URL(fileURLWithPath: $0) })
        }
        guard let stream = FSEventStreamCreate(nil, callback, &context, paths as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
                                               Self.latency, flags)
        else {
            Logger.language.error("watch \(paths.count) folders outside the workspace failed: FSEventStreamCreate returned nil")
            box.release()
            return nil
        }
        self.stream = stream
        self.box = box
        FSEventStreamSetDispatchQueue(stream, queue)
        guard FSEventStreamStart(stream) else {
            Logger.language.error("watch \(paths.count) folders outside the workspace failed: FSEventStreamStart refused")
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            box.release()
            return nil
        }
    }

    deinit {
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        box.release()
    }
}
