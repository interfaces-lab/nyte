import AppKit
import NyteUI
import NyteCore
import os
import UniformTypeIdentifiers

extension EditorViewController {
    func load(_ id: Int, url: URL, language: Language) {
        Task {
            let file = await Task.detached(priority: .userInitiated) { FileIO.load(url, language: language) }.value
            fill(id, with: file)
        }
    }

    func fill(_ id: Int, with file: LoadedFile) {
        guard let index = row(id) else { return }
        if case .loading(let opening) = documents[index].body {
            defer { OSSignposter.editor.endInterval("open", opening) }
            return apply(file, to: index)
        }
        apply(file, to: index)
    }

    private func apply(_ file: LoadedFile, to index: Int) {
        guard case .text(let decoded) = file.content else {
            documents[index].body = .notice(describe(file, url: documents[index].url))
            if index == selectedIndex { show() }
            return
        }
        let model = documents[index].model
        let before = documents[index].isOpenInIntelligence ? documents[index].lines.end(length: documents[index].length) : nil
        let isShown = textView.model === model
        let viewport = isShown ? currentViewport : documents[index].viewport
        let selections = model.session.selections
        var session = EditSession(decoded.store, context: EditContext(indent: indent(of: documents[index]), language: documents[index].language))
        session.select(selections.clamped(to: decoded.store.length))
        model.session = session
        model.widestColumns = decoded.widestLineColumns
        model.widest = 0
        let url = documents[index].url
        if let before {
            intelligence?.change(url, range: TextSpan(start: TextPosition(line: 0, column: 0), end: before), text: decoded.text)
        } else if intelligence?.handles(url) == true {
            intelligence?.open(url, text: decoded.text)
            documents[index].isOpenInIntelligence = true
        }
        documents[index].undo.removeAllActions()
        documents[index].body = .text
        documents[index].format = decoded.format
        documents[index].detectedIndent = decoded.detectedIndent
        documents[index].modified = file.modified
        documents[index].savedDigest = decoded.digest
        documents[index].savedLength = decoded.store.length
        documents[index].isDirty = false
        documents[index].revision += 1
        documents[index].viewport = viewport
        if isShown { textView.attach(blank) }
        if index == selectedIndex { show() }
        if let state = documents[index].pendingState {
            documents[index].pendingState = nil
            apply(state, to: index)
        }
        if let pending = documents[index].pendingReveal {
            documents[index].pendingReveal = nil
            if index == selectedIndex { select(pending) }
        }
    }

    private func describe(_ file: LoadedFile, url: URL) -> String {
        let description = UTType(filenameExtension: url.pathExtension)?.localizedDescription ?? "File"
        let kind = description.prefix(1).uppercased() + description.dropFirst()
        let size = ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file)
        return switch file.content {
        case .binary: "\(kind), \(size). Binary files are not shown as text."
        case .tooLarge(let limit):
            "\(kind), \(size). Files over \(ByteCountFormatter.string(fromByteCount: Int64(limit), countStyle: .file)) are not opened."
        case .undecodable: "\(kind), \(size). Its text encoding is not recognised."
        case .unreadable, .text: "\(url.lastPathComponent) could not be read."
        }
    }

    @discardableResult
    func save(_ id: Int, alerting: Bool = true) async -> Bool {
        let provided = await beforeSaveEdits(id)
        prepareForSave(id, applying: provided)
        guard let index = row(id), documents[index].body.isText else { return false }
        let snapshot = documents[index].store.buffer
        let format = documents[index].format
        let url = documents[index].url
        let revision = documents[index].revision
        let length = documents[index].length
        let result = await Task.detached(priority: .userInitiated) { FileIO.save(snapshot.string, format: format, to: url) }.value
        switch result {
        case .success(let saved):
            guard let index = row(id) else { return true }
            documents[index].savedDigest = saved.digest
            documents[index].savedLength = length
            documents[index].modified = saved.modified
            documents[index].format.encoding = saved.encoding
            if documents[index].revision == revision { documents[index].isDirty = false }
            if documents[index].isOpenInIntelligence { intelligence?.save(url) }
            onTabsChange?()
            return true
        case .failure(let error):
            guard alerting, let window = view.window else { return false }
            _ = await NSAlert(error: error).beginSheetModal(for: window)
            return false
        }
    }

    private func prepareForSave(_ id: Int, applying provided: (edits: [TextEdit], revision: Int)?) {
        guard let index = row(id), documents[index].body.isText else { return }
        if shown?.id == id { textView.breakUndoCoalescing() }
        let edits = !(provided?.edits.isEmpty ?? true) || preferences.trimsTrailingWhitespace || preferences.ensuresFinalNewline
        let undo = documents[index].undo
        if edits { undo.beginUndoGrouping() }
        defer { if edits { undo.endUndoGrouping() } }
        guard let provided, !provided.edits.isEmpty, documents[index].revision == provided.revision else { return cleanUp(id) }
        _ = replace(provided.edits, in: documents[index])
        cleanUp(id)
    }

    private func cleanUp(_ id: Int) {
        guard preferences.trimsTrailingWhitespace || preferences.ensuresFinalNewline, let index = row(id) else { return }
        let document = documents[index]
        let text = document.text
        let caretLine = shown?.id == id ? document.lines.line(at: textView.selectedRange().location) : nil
        let cleanup = SaveCleanup.edits(in: text, lines: document.lines, trimsTrailingWhitespace: preferences.trimsTrailingWhitespace,
                                        ensuresFinalNewline: preferences.ensuresFinalNewline, keepingLine: caretLine)
        guard !cleanup.isEmpty else { return }
        let edits = cleanup.map { edit in
            TextEdit(range: TextSpan(start: document.lines.position(at: edit.range.location),
                                     end: document.lines.position(at: NSMaxRange(edit.range))), text: edit.text)
        }
        _ = replace(edits, in: document)
    }

    private func beforeSaveEdits(_ id: Int) async -> (edits: [TextEdit], revision: Int)? {
        guard let beforeSave, let index = row(id), documents[index].body.isText else { return nil }
        let url = documents[index].url
        let revision = documents[index].revision
        let deadline = beforeSaveDeadline
        let edits = await FirstAnswer.within(deadline) { await beforeSave(url, deadline) } ?? []
        return (edits, revision)
    }

    @objc func applicationDidBecomeActive() {
        reloadFromDisk(documents.filter { !$0.isDirty && $0.body.isText }.map { (id: $0.id, url: $0.url, modified: $0.modified, language: $0.language) },
                       onlyIfModified: true)
    }

    func markEdited(_ id: Int) {
        guard let index = row(id) else { return }
        let wasDirty = documents[index].isDirty
        documents[index].isDirty = true
        documents[index].isPreview = false
        if !wasDirty { onTabsChange?() }
    }

    func forget(_ document: Document) {
        if document.isOpenInIntelligence { intelligence?.close(document.url) }
    }
}
