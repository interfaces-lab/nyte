import CoreServices
import Foundation

@MainActor
final class DirectoryWatcher {
    struct Change {
        let path: String
        let recursive: Bool
        let isFile: Bool
    }

    private static let latency: CFTimeInterval = 0.2
    private let handler: ([Change]) -> Void
    private var stream: FSEventStreamRef?

    init(path: String, handler: @escaping ([Change]) -> Void) {
        self.handler = handler
        var context = FSEventStreamContext(
            version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, count, paths, eventFlags, _ in
            guard let info else { return }
            let list = paths.assumingMemoryBound(to: UnsafePointer<CChar>.self)
            let mustScan = FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs)
            let file = FSEventStreamEventFlags(kFSEventStreamEventFlagItemIsFile)
            let changes = (0..<count).map {
                Change(path: String(cString: list[$0]), recursive: eventFlags[$0] & mustScan != 0,
                       isFile: eventFlags[$0] & file != 0)
            }
            MainActor.assumeIsolated {
                Unmanaged<DirectoryWatcher>.fromOpaque(info).takeUnretainedValue().handler(changes)
            }
        }
        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &context, [path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), Self.latency,
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents)
        ) else {
            FilesLog.logger.error("FSEventStreamCreate failed for \(path, privacy: .public); the tree will not follow changes")
            return
        }
        FSEventStreamSetDispatchQueue(stream, .main)
        guard FSEventStreamStart(stream) else {
            FilesLog.logger.error("FSEventStreamStart failed for \(path, privacy: .public)")
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            return
        }
        self.stream = stream
    }

    isolated deinit {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }
}
