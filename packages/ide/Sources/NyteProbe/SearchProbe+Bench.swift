import AppKit
import Darwin
import Foundation
import NyteCore
@testable import NyteSearch

enum SearchBench {
    struct Case {
        let name: String
        let query: SearchQuery
        let grep: [String]
        let rg: [String]
    }

    static let ripgrep = "/opt/homebrew/bin/rg"

    @MainActor static func run(_ arguments: [String]) async {
        let root = arguments.first.map { URL(fileURLWithPath: $0) } ?? SearchProbeRun.repository
        let cases = [
            Case(name: "rare literal", query: SearchQuery("LiteralScanner", caseMode: .sensitive), grep: ["-F", "LiteralScanner"],
                 rg: ["-F", "-s", "LiteralScanner"]),
            Case(name: "common literal", query: SearchQuery("return", caseMode: .sensitive), grep: ["-F", "return"], rg: ["-F", "-s", "return"]),
            Case(name: "case-insensitive literal", query: SearchQuery("palette", caseMode: .insensitive), grep: ["-F", "-i", "palette"],
                 rg: ["-F", "-i", "palette"]),
            Case(name: "regex", query: SearchQuery("func \\w+\\(", caseMode: .sensitive, isRegex: true), grep: ["-E", "func [A-Za-z0-9_]+\\("],
                 rg: ["-s", "func \\w+\\("]),
        ]
        print("root: \(root.path)")
        let started = ContinuousClock.now
        let cold = SearchEngine(root: root)
        let files = cold.files(includingIgnored: false)
        print("file list: \(files.count) files from \(files.source) in \(ms(ContinuousClock.now - started))")
        let paths = files.paths
        let bytes = paths.reduce(0) { total, path in
            total + ((try? FileManager.default.attributesOfItem(atPath: root.appendingPathComponent(path).path)[.size] as? Int) ?? 0)
        }
        let list = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-search-bench-\(UUID().uuidString)")
        try? Data(paths.joined(separator: "\u{0}").utf8).write(to: list)
        defer { try? FileManager.default.removeItem(at: list) }
        print("bytes: \(bytes / 1_000_000) MB; workers: \(SearchEngine.workerCount); resident before: \(resident() / 1_000_000) MB")
        print("")
        print("| query | engine | first result | complete | matches | resident |")
        print("|---|---|---|---|---|---|")
        for item in cases {
            var limits = item.query.limits
            limits.matches = 10_000_000
            limits.matchesPerFile = 1_000_000
            var query = item.query
            query.limits = limits
            let coldEngine = SearchEngine(root: root)
            let coldRun = await timed(coldEngine, query)
            print("| \(item.name) | nyte cold | \(ms(coldRun.first)) | \(ms(coldRun.total)) | \(coldRun.count) | \(resident() / 1_000_000) MB |")
            var warm: [(first: Duration?, total: Duration, count: Int)] = []
            for _ in 0..<5 { warm.append(await timed(cold, query)) }
            let best = warm.min { $0.total < $1.total } ?? coldRun
            let median = warm.map(\.total).sorted()[warm.count / 2]
            print("| \(item.name) | nyte warm (best, median) | \(ms(best.first)) | \(ms(best.total)), \(ms(median)) | \(best.count) | \(resident() / 1_000_000) MB |")
            let grep = external("/usr/bin/xargs", ["-0", "/usr/bin/grep", "-n", "-H"] + item.grep + ["--"], in: root,
                                environment: ["LC_ALL": "C"], input: list)
            print("| \(item.name) | grep -n (same files) | \(ms(grep.first)) | \(ms(grep.total)) | \(grep.lines) lines | \(grep.resident / 1_000_000) MB |")
            if arguments.count > 1 {
                let recursive = external("/usr/bin/grep", ["-r", "-n"] + item.grep + ["."], in: root, environment: ["LC_ALL": "C"])
                print("| \(item.name) | grep -rn (whole tree) | \(ms(recursive.first)) | \(ms(recursive.total)) | \(recursive.lines) lines | \(recursive.resident / 1_000_000) MB |")
            }
            if FileManager.default.isExecutableFile(atPath: ripgrep) {
                let rg = external(ripgrep, ["-n", "--no-config"] + item.rg + ["."], in: root, environment: [:])
                print("| \(item.name) | rg -n | \(ms(rg.first)) | \(ms(rg.total)) | \(rg.lines) lines | \(rg.resident / 1_000_000) MB |")
                let sorted = external(ripgrep, ["-n", "--no-config", "--sort", "path"] + item.rg + ["."], in: root, environment: [:])
                print("| \(item.name) | rg -n --sort path | \(ms(sorted.first)) | \(ms(sorted.total)) | \(sorted.lines) lines | \(sorted.resident / 1_000_000) MB |")
            }
        }
        print("")
        await typing(cold)
        await window(root: root)
        await rows()
        scanners(cold, root: root)
        regexEngines(cold, root: root)
        print("resident at the end: \(resident() / 1_000_000) MB")
    }

    static func timed(_ engine: SearchEngine, _ query: SearchQuery) async -> (first: Duration?, total: Duration, count: Int) {
        let started = ContinuousClock.now
        let outcome = await SearchProbeRun.collect(engine, query)
        return (outcome.firstBatch, ContinuousClock.now - started, outcome.results.matchCount)
    }

    static func typing(_ engine: SearchEngine) async {
        let word = "SearchEngine"
        var firsts: [Duration] = []
        var previous: SearchRun?
        for length in 2...word.count {
            previous?.cancel()
            let started = ContinuousClock.now
            guard let run = try? engine.start(SearchQuery(String(word.prefix(length)))) else { continue }
            previous = run
            for await event in run.events {
                if case let .batch(batch, _) = event, !batch.isEmpty {
                    firsts.append(ContinuousClock.now - started)
                    break
                }
                if case .finished = event { break }
            }
        }
        previous?.cancel()
        let sorted = firsts.sorted()
        print("typing \(word) one key at a time, each cancelling the last: first result median \(ms(sorted[sorted.count / 2])), worst \(ms(sorted.last))")
    }

    @MainActor static func window(root: URL) async {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let controller = FindInFilesViewController(workspace: Workspace(root: root))
        let window = KitProbeWindow(size: NSSize(width: 1_000, height: 240))
        window.place(controller.view, at: .zero, size: NSSize(width: 1_000, height: 240))
        _ = controller.engine.files(includingIgnored: false)
        var shown: [Duration] = []
        var spent: [Double] = []
        let word = "SearchEngine"
        for length in 2...word.count {
            let cpu = Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6
            let started = ContinuousClock.now
            controller.bar.field.stringValue = String(word.prefix(length))
            var appeared = false
            while ContinuousClock.now - started < .seconds(5) {
                if case .done = controller.phase { appeared = true }
                if !controller.awaitingSwap, controller.results.matchCount > 0 { appeared = true }
                if appeared { break }
                try? await Task.sleep(for: .milliseconds(1))
                guard !Task.isCancelled else { break }
            }
            if appeared {
                shown.append(ContinuousClock.now - started)
                spent.append(Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6 - cpu)
            }
        }
        let sorted = shown.sorted()
        print("typing into the window: rows on screen median \(ms(sorted[sorted.count / 2])), worst \(ms(sorted.last))")
        let cpu = spent.sorted()
        print(String(format: "typing into the window: main-thread CPU from key to rows median %.1f ms, worst %.1f ms", cpu[cpu.count / 2], cpu.last ?? 0))
        let full = await fill(controller, with: "return")
        print("10,000 results into the window with widestNumber: finished in \(ms(full.total)), longest main-thread stall \(ms(full.stall)), \(controller.rowKind.count.formatted()) rows")
        _ = await fill(controller, with: "")
        controller.list.widestNumber = nil
        let measured = await fill(controller, with: "return")
        print("10,000 results into the window without widestNumber: finished in \(ms(measured.total)), longest main-thread stall \(ms(measured.stall))")
        window.orderOut(nil)
    }

    @MainActor static func fill(_ controller: FindInFilesViewController, with text: String) async -> (total: Duration, stall: Duration) {
        let started = ContinuousClock.now
        controller.bar.field.stringValue = text
        var last = ContinuousClock.now
        var stall = Duration.zero
        while ContinuousClock.now - started < .seconds(30) {
            let now = ContinuousClock.now
            stall = max(stall, now - last)
            last = now
            if case .done = controller.phase { break }
            try? await Task.sleep(for: .milliseconds(1))
            guard !Task.isCancelled else { break }
        }
        return (ContinuousClock.now - started, stall)
    }

    static func scanners(_ engine: SearchEngine, root: URL) {
        var haystack: [UInt8] = []
        let files = engine.files(includingIgnored: false)
        for index in 0..<files.count {
            if let data = FileManager.default.contents(atPath: root.appendingPathComponent(files.path(index)).path),
               !data.prefix(8_192).contains(0) {
                haystack.append(contentsOf: data)
            }
        }
        let needles = ["LiteralScanner", "return", "zq9x never"]
        haystack.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            for needle in needles {
                let bytes = Array(needle.utf8)
                let scanner = LiteralScanner(bytes, foldsCase: false)
                let folding = LiteralScanner(bytes, foldsCase: true)
                let mine = count { scanner.find(base, count: buffer.count, from: $0).map { $0 + bytes.count } }
                let folded = count { folding.find(base, count: buffer.count, from: $0).map { $0 + bytes.count } }
                let system = count { from in
                    bytes.withUnsafeBufferPointer { wanted in
                        memmem(base + from, buffer.count - from, wanted.baseAddress, wanted.count)
                            .map { base.distance(to: $0.assumingMemoryBound(to: UInt8.self)) + wanted.count }
                    }
                }
                let size = Double(buffer.count)
                print(String(format: "scan %@ over %.0f MB: mine %.1f GB/s (%d), ASCII-folding %.1f GB/s (%d), memmem %.1f GB/s (%d)",
                             needle, size / 1e6, size / mine.seconds / 1e9, mine.hits, size / folded.seconds / 1e9, folded.hits,
                             size / system.seconds / 1e9, system.hits))
            }
        }
    }

    static func count(_ next: (Int) -> Int?) -> (seconds: Double, hits: Int) {
        let started = ContinuousClock.now
        var hits = 0
        var from = 0
        while let end = next(from) {
            hits += 1
            from = end
        }
        let elapsed = ContinuousClock.now - started
        return (Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18, hits)
    }

    static func regexEngines(_ engine: SearchEngine, root: URL) {
        let files = engine.files(includingIgnored: false)
        var text = ""
        for index in 0..<files.count where files.path(index).hasSuffix(".swift") || files.path(index).hasSuffix(".ts") {
            if let data = FileManager.default.contents(atPath: root.appendingPathComponent(files.path(index)).path) {
                text += String(decoding: data, as: UTF8.self)
            }
        }
        let pattern = "func \\w+\\("
        let started = ContinuousClock.now
        let foundation = (try? NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines]))
            .map { $0.numberOfMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length)) } ?? -1
        let foundationTime = ContinuousClock.now - started
        let swiftStarted = ContinuousClock.now
        let swift = (try? Regex(pattern)).map { text.matches(of: $0).count } ?? -1
        let swiftTime = ContinuousClock.now - swiftStarted
        print("regex \(pattern) over \(text.utf8.count / 1_000_000) MB of Swift and TypeScript: NSRegularExpression \(ms(foundationTime)) (\(foundation)), Swift Regex \(ms(swiftTime)) (\(swift))")
    }

    static func external(_ executable: String, _ arguments: [String], in folder: URL, environment: [String: String], input: URL? = nil)
        -> (first: Duration?, total: Duration, lines: Int, resident: Int) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/time")
        process.arguments = ["-l", executable] + arguments
        process.currentDirectoryURL = folder
        var merged = ProcessInfo.processInfo.environment
        for (key, value) in environment { merged[key] = value }
        process.environment = merged
        let output = Pipe(), diagnostics = Pipe()
        process.standardOutput = output
        process.standardError = diagnostics
        process.standardInput = input.flatMap { try? FileHandle(forReadingFrom: $0) } ?? FileHandle.nullDevice
        let started = ContinuousClock.now
        guard (try? process.run()) != nil else { return (nil, .zero, 0, 0) }
        var first: Duration?
        var lines = 0
        while true {
            let chunk = output.fileHandleForReading.availableData
            if chunk.isEmpty { break }
            if first == nil { first = ContinuousClock.now - started }
            lines += chunk.reduce(0) { $0 + ($1 == 0x0A ? 1 : 0) }
        }
        let report = String(decoding: diagnostics.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        let total = ContinuousClock.now - started
        let resident = report.split(separator: "\n").first { $0.contains("maximum resident set size") }
            .flatMap { Int($0.split(separator: " ").first ?? "") } ?? 0
        return (first, total, lines, resident)
    }

    static func resident() -> Int {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let status = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count) }
        }
        return status == KERN_SUCCESS ? Int(info.resident_size) : 0
    }

    static func ms(_ duration: Duration?) -> String {
        guard let duration else { return "-" }
        let value = Double(duration.components.seconds) * 1_000 + Double(duration.components.attoseconds) / 1e15
        return String(format: value < 10 ? "%.1f ms" : "%.0f ms", value)
    }
}
