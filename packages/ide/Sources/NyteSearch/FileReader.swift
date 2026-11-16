import Darwin
import Foundation

final class FileReader {
    enum Read {
        case bytes(UnsafePointer<UInt8>, Int)
        case large
        case missing
        case failed(String)
    }

    private let limit: Int
    private var path: [UInt8]
    private let prefixLength: Int
    private var buffer: UnsafeMutableRawPointer
    private var capacity: Int

    init(prefix: [UInt8], limit: Int) {
        self.limit = limit
        path = prefix
        prefixLength = prefix.count
        capacity = 1 << 16
        buffer = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: 64)
    }

    deinit {
        buffer.deallocate()
    }

    func read<Result>(_ relative: UnsafeBufferPointer<UInt8>, _ body: (Read) -> Result) -> Result {
        path.removeSubrange(prefixLength...)
        path.append(contentsOf: relative)
        path.append(0)
        let descriptor = path.withUnsafeBufferPointer { name in
            name.withMemoryRebound(to: CChar.self) { open($0.baseAddress!, O_RDONLY | O_CLOEXEC) }
        }
        guard descriptor >= 0 else { return body(Self.failure(errno)) }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0 else { return body(Self.failure(errno)) }
        guard info.st_mode & S_IFMT == S_IFREG else { return body(.missing) }
        let size = Int(info.st_size)
        guard size <= limit else { return body(.large) }
        guard size > 0 else { return body(.missing) }
        guard size > SearchEngine.readLimit else { return readWhole(descriptor, size: size, body) }
        guard let mapped = mmap(nil, size, PROT_READ, MAP_PRIVATE, descriptor, 0), mapped != MAP_FAILED else {
            return body(Self.failure(errno))
        }
        defer { munmap(mapped, size) }
        _ = madvise(mapped, size, MADV_SEQUENTIAL)
        return body(.bytes(UnsafePointer(mapped.assumingMemoryBound(to: UInt8.self)), size))
    }

    private func readWhole<Result>(_ descriptor: Int32, size: Int, _ body: (Read) -> Result) -> Result {
        if size > capacity {
            buffer.deallocate()
            capacity = max(size, capacity * 2)
            buffer = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: 64)
        }
        var filled = 0
        while filled < size {
            let got = Darwin.read(descriptor, buffer + filled, size - filled)
            if got < 0, errno == EINTR { continue }
            guard got >= 0 else { return body(Self.failure(errno)) }
            if got == 0 { break }
            filled += got
        }
        return body(.bytes(UnsafePointer(buffer.assumingMemoryBound(to: UInt8.self)), filled))
    }

    private static func failure(_ code: Int32) -> Read {
        code == ENOENT || code == ENOTDIR ? .missing : .failed(String(cString: strerror(code)))
    }
}
