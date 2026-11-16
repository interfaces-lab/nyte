import Foundation
import NyteCore

extension Debugger {
    static let hoverPattern = #"^[A-Za-z_$][\w$]*(?:\.#?[A-Za-z_$][\w$]*|\[\d+\])*$"#

    public func hoverValue(of expression: String, at location: FileLocation) async -> Result<DebugVariable, DebugFailure>? {
        let expression = expression.trimmingCharacters(in: .whitespaces)
        guard case .paused = state, let frame = selectedFrame, !Task.isCancelled,
              frame.url?.standardizedFileURL == location.url.standardizedFileURL,
              expression.range(of: Self.hoverPattern, options: .regularExpression) != nil,
              !InlineValues.keywords.contains(expression)
        else { return nil }
        let result = await evaluate(expression, in: frame, context: .hover)
        guard !Task.isCancelled, case .paused = state, selectedFrame == frame else { return nil }
        return result
    }

    public func inlineValues(in url: URL, line text: (Int) -> String?) async -> [InlineValue] {
        guard case .paused = state, let frame = selectedFrame, frame.url?.standardizedFileURL == url.standardizedFileURL else { return [] }
        let start = InlineValues.functionStart(before: frame.line, line: text)
        let lines = (start...frame.line).compactMap { index in text(index).map { (line: index, text: $0) } }
        var locals: [String: DebugVariable] = [:]
        for scope in await scopes(of: frame) where !scope.isExpensive && scope.reference > 0 {
            for variable in await children(of: scope.reference) where locals[variable.name] == nil {
                locals[variable.name] = variable
            }
        }
        guard selectedFrame == frame else { return [] }
        return InlineValues.values(lines: lines, locals: locals)
    }

    var codeLanguage: String {
        switch lastStart?.target.kind {
        case .goPackage, .goTest: "go"
        case let .node(file): file.pathExtension
        case nil: ""
        }
    }

    public func completions(for text: String, column: Int) async -> [DebugCompletion] {
        guard let session, case .paused = state else { return [] }
        return await session.completions(text, column: column, frame: selectedFrame?.id)
    }

    public func sendInput(_ text: String) async -> Bool {
        guard let session, !inputEnded, state == .running || { if case .paused = state { true } else { false } }() else { return false }
        return await session.sendInput(text)
    }

    public func endInput() async -> Bool {
        guard let session, !inputEnded, state == .running || { if case .paused = state { true } else { false } }() else { return false }
        guard await session.endInput() else { return false }
        inputEnded = true
        onChange?(.state)
        return true
    }

    public func toolStatus() async -> [DebugToolStatus] {
        var found: [DebugToolStatus] = []
        for tool in DebugTool.allCases {
            found.append(await ToolResolver.status(tool, settings: settings, toolchain: toolchain, readsVersion: true))
        }
        return found
    }

    public func targets(near file: URL?) async -> [DebugTarget] {
        let workspace = workspace
        return await Task.detached {
            let saved = RunConfigurationFile.read(in: workspace).map { $0.target(in: workspace) }
            return saved + TargetFinder.targets(in: workspace, near: file)
        }.value
    }

    public func runConfigurations() async -> [RunConfiguration] {
        let workspace = workspace
        return await Task.detached { RunConfigurationFile.read(in: workspace) }.value
    }

    public func detectedConfigurations(near file: URL?) async -> [RunConfiguration] {
        let workspace = workspace
        return await Task.detached {
            TargetFinder.targets(in: workspace, near: file).map { RunConfiguration(target: $0, in: workspace) }
        }.value
    }

    public func saveRunConfigurations(_ configurations: [RunConfiguration]) async throws {
        let workspace = workspace
        try await Task.detached { try RunConfigurationFile.write(configurations, in: workspace) }.value
    }
}
