import Darwin
import Foundation
import os
import Synchronization

public final class SearchEngine: Sendable {
    public static let workerCount = max(2, min(ProcessInfo.processInfo.activeProcessorCount, 12))
    static let flushInterval = Duration.milliseconds(24)
    public static let stallBudget = Duration.milliseconds(30)
    static let tick = DispatchTimeInterval.milliseconds(10)
    static let readLimit = 1 << 20

    public let root: URL
    private let lists = Mutex<[Bool: SearchFiles]>([:])

    public init(root: URL) {
        self.root = root.standardizedFileURL
    }

    public func files(includingIgnored: Bool) -> SearchFiles {
        if let known = lists.withLock({ $0[includingIgnored] }) { return known }
        let loaded = SearchFiles.load(root: root, includingIgnored: includingIgnored)
        lists.withLock { $0[includingIgnored] = loaded }
        return loaded
    }

    public func invalidateFiles() {
        lists.withLock { $0.removeAll() }
    }

    public var hasFiles: Bool { lists.withLock { !$0.isEmpty } }

    public static func validate(_ query: SearchQuery) -> PatternError? {
        do {
            _ = try MatchPlan.make(query)
            return nil
        } catch {
            return error
        }
    }

    public func start(_ query: SearchQuery, unsaved: [String: String] = [:]) throws(PatternError) -> SearchRun {
        let plan = try MatchPlan.make(query)
        let run = SearchRun()
        let root = root
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let files: SearchFiles = switch query.scope {
            case let .files(paths): SearchFiles(root: root, paths: paths)
            case .workspace, .folder: self.files(includingIgnored: query.includesIgnored).merging(Array(unsaved.keys))
            }
            run.state.begin(files: files, plan: plan, filter: PathFilter(query), unsaved: unsaved)
        }
        return run
    }
}

public final class SearchRun: Sendable {
    public let events: AsyncStream<SearchEvent>
    let state: RunState

    init() {
        let (events, emit) = AsyncStream.makeStream(of: SearchEvent.self)
        self.events = events
        state = RunState(emit: emit)
    }

    public func cancel() {
        state.cancel()
    }

    public var isCancelled: Bool { state.cancelled.load(ordering: .relaxed) }
}

enum Release: Equatable {
    case wait
    case inOrder
    case outOfOrder

    static func decide(frontierWaiting: Duration, completedBeyond: Bool) -> Release {
        guard completedBeyond else { return .inOrder }
        return frontierWaiting >= SearchEngine.stallBudget ? .outOfOrder : .wait
    }
}

final class RunState: Sendable {
    enum Outcome: Sendable {
        case pending
        case empty
        case matched(SearchResults)
        case emitted
    }

    struct Ledger: Sendable {
        var outcomes: [Outcome] = []
        var frontier = 0
        var frontierMoved = ContinuousClock.now
        var completedBeyond = 0
        var pending = SearchResults()
        var progress = SearchProgress()
        var failures: [SearchFailure] = []
        var binary = 0
        var large = 0
        var lastFlush = ContinuousClock.now
        var firstResult: Duration?
        var workers = 0
        var ending = SearchSummary.Ending.complete
        var isFinished = false
        var files: SearchFiles?
    }

    let cancelled = Atomic<Bool>(false)
    private let matchLimit = Atomic<Int>(Int.max)
    private let next = Atomic<Int>(0)
    private let emit: AsyncStream<SearchEvent>.Continuation
    private let ledger = Mutex(Ledger())
    private let ticker = Mutex<DispatchSourceTimer?>(nil)
    private let started = ContinuousClock.now

    init(emit: AsyncStream<SearchEvent>.Continuation) {
        self.emit = emit
    }

    func cancel() {
        guard !cancelled.exchange(true, ordering: .relaxed) else { return }
        ledger.withLock { ledger in
            if ledger.ending == .complete { ledger.ending = .cancelled }
            if ledger.workers == 0, ledger.files == nil { finish(&ledger) }
        }
    }

    func begin(files: SearchFiles, plan: MatchPlan, filter: PathFilter, unsaved: [String: String]) {
        let workers = min(SearchEngine.workerCount, max(1, files.count))
        matchLimit.store(plan.limits.matches, ordering: .relaxed)
        let proceed = ledger.withLock { ledger -> Bool in
            guard !ledger.isFinished else { return false }
            ledger.files = files
            ledger.outcomes = Array(repeating: .pending, count: files.count)
            ledger.progress.filesTotal = files.count
            ledger.workers = workers
            ledger.frontierMoved = .now
            if files.count == 0 { finish(&ledger) }
            return files.count > 0
        }
        guard proceed else { return }
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + SearchEngine.tick, repeating: SearchEngine.tick)
        timer.setEventHandler { [weak self] in self?.tick() }
        ticker.withLock { $0 = timer }
        timer.resume()
        let rootPrefix = Array((files.root + "/").utf8)
        for _ in 0..<workers {
            DispatchQueue.global(qos: .userInitiated).async {
                self.work(files: files, plan: plan, filter: filter, unsaved: unsaved, rootPrefix: rootPrefix)
            }
        }
    }

    private func work(files: SearchFiles, plan: MatchPlan, filter: PathFilter, unsaved: [String: String], rootPrefix: [UInt8]) {
        let scanner = FileScanner(plan)
        let reader = FileReader(prefix: rootPrefix, limit: plan.limits.fileBytes)
        let isCancelled = { self.cancelled.load(ordering: .relaxed) }
        while !isCancelled() {
            let index = next.add(1, ordering: .relaxed).oldValue
            guard index < files.count else { break }
            let admitted = filter.isEmpty || files.withPath(index) { filter.admits($0) }
            let read: FileRead = admitted ? autoreleasepool {
                let path = files.path(index)
                if var text = unsaved[path] {
                    return text.withUTF8 { buffer in
                        guard let base = buffer.baseAddress else { return .empty }
                        return FileRead(scanner.scan(base, count: buffer.count, path: path, order: index, isCancelled: isCancelled))
                    }
                }
                return files.withPath(index) { relative in
                    reader.read(relative) { read in
                        switch read {
                        case let .bytes(base, count):
                            guard !ByteScan.isBinary(base, count: count) else { return .binary }
                            return FileRead(scanner.scan(base, count: count, path: path, order: index, isCancelled: isCancelled))
                        case .large: return .large
                        case .missing: return .empty
                        case let .failed(reason): return .failed(reason)
                        }
                    }
                }
            } : .empty
            complete(index, read)
        }
        ledger.withLock { ledger in
            ledger.workers -= 1
            if ledger.workers == 0 { finish(&ledger) }
        }
    }

    private func complete(_ index: Int, _ read: FileRead) {
        ledger.withLock { ledger in
            guard !ledger.isFinished else { return }
            ledger.progress.filesSearched += 1
            switch read {
            case .empty: ledger.outcomes[index] = .empty
            case let .matched(results):
                ledger.outcomes[index] = .matched(results)
                if index > ledger.frontier { ledger.completedBeyond += 1 }
            case .binary:
                ledger.binary += 1
                ledger.outcomes[index] = .empty
            case .large:
                ledger.large += 1
                ledger.outcomes[index] = .empty
            case let .failed(reason):
                ledger.failures.append(SearchFailure(path: ledger.files?.path(index) ?? "", reason: reason))
                ledger.outcomes[index] = .empty
            }
            advance(&ledger, completed: index)
            flushIfDue(&ledger)
        }
    }

    private func tick() {
        ledger.withLock { ledger in
            guard !ledger.isFinished else { return }
            let release = Release.decide(frontierWaiting: ContinuousClock.now - ledger.frontierMoved,
                                         completedBeyond: ledger.completedBeyond > 0)
            if release == .outOfOrder { releaseBeyondFrontier(&ledger) }
            flushIfDue(&ledger)
        }
    }

    private func advance(_ ledger: inout Ledger, completed: Int? = nil) {
        let before = ledger.frontier
        while ledger.frontier < ledger.outcomes.count, ledger.ending != .capped {
            switch ledger.outcomes[ledger.frontier] {
            case .pending:
                if ledger.frontier != before { ledger.frontierMoved = .now }
                return
            case let .matched(results):
                if ledger.frontier != completed { ledger.completedBeyond -= 1 }
                take(results, into: &ledger)
            case .empty, .emitted: break
            }
            ledger.outcomes[ledger.frontier] = .emitted
            ledger.frontier += 1
        }
        if ledger.frontier != before { ledger.frontierMoved = .now }
    }

    private func releaseBeyondFrontier(_ ledger: inout Ledger) {
        for index in ledger.frontier + 1..<ledger.outcomes.count where ledger.ending != .capped {
            guard case let .matched(results) = ledger.outcomes[index] else { continue }
            take(results, into: &ledger)
            ledger.outcomes[index] = .emitted
        }
        ledger.completedBeyond = 0
    }

    private func take(_ results: SearchResults, into ledger: inout Ledger) {
        let limit = matchLimit.load(ordering: .relaxed)
        let fits = min(results.matchCount, max(0, limit - ledger.progress.matches))
        ledger.pending.append(fits == results.matchCount ? results : results.prefix(matches: fits))
        ledger.progress.matches += fits
        ledger.progress.filesMatched += fits > 0 ? 1 : 0
        if ledger.firstResult == nil { ledger.firstResult = ContinuousClock.now - started }
        guard fits < results.matchCount else { return }
        ledger.ending = .capped
        cancelled.store(true, ordering: .relaxed)
        flush(&ledger)
    }

    private func flushIfDue(_ ledger: inout Ledger) {
        let first = ledger.progress.matches == ledger.pending.matchCount && !ledger.pending.isEmpty
        if first || ContinuousClock.now - ledger.lastFlush >= SearchEngine.flushInterval { flush(&ledger) }
    }

    private func flush(_ ledger: inout Ledger) {
        ledger.lastFlush = .now
        emit.yield(.batch(ledger.pending, ledger.progress))
        ledger.pending = SearchResults()
    }

    private func finish(_ ledger: inout Ledger) {
        guard !ledger.isFinished else { return }
        ticker.withLock { timer in
            timer?.cancel()
            timer = nil
        }
        if ledger.ending != .capped, ledger.ending != .cancelled { advance(&ledger) }
        ledger.isFinished = true
        if !ledger.pending.isEmpty || ledger.progress.filesSearched > 0 { flush(&ledger) }
        emit.yield(.finished(SearchSummary(
            ending: ledger.ending, progress: ledger.progress,
            failures: ledger.failures.sorted { SearchFiles.precedes(Array($0.path.utf8)[...], Array($1.path.utf8)[...]) },
            binaryFiles: ledger.binary, largeFiles: ledger.large, elapsed: ContinuousClock.now - started,
            firstResult: ledger.firstResult
        )))
        emit.finish()
        ledger.outcomes = []
    }
}

enum FileRead {
    case empty
    case matched(SearchResults)
    case binary
    case large
    case failed(String)

    init(_ results: SearchResults?) {
        self = results.map { .matched($0) } ?? .empty
    }
}
