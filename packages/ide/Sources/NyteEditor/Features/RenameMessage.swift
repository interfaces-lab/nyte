import Foundation
import NyteUI

enum RenameMessage {
    static func plain(_ server: String, name: String, language: String, keywords: Set<String>) -> String {
        let lowered = server.lowercased()
        let quoted = "“\(name)”"
        if keywords.contains(name) { return "\(quoted) is a \(language) keyword. Choose another name." }
        if lowered.contains("invalid identifier") || lowered.contains("not a valid identifier") {
            return "\(quoted) is not a valid name. Use letters, digits and underscores, starting with a letter."
        }
        if lowered.contains("conflict") || lowered.contains("already declared") || lowered.contains("redeclared") {
            return "Another declaration named \(quoted) is already in scope. Choose another name."
        }
        if lowered.contains("builtin") || lowered.contains("standard typescript library") {
            return "Names that come with the language can’t be renamed."
        }
        if lowered.contains("node_modules") || lowered.contains("outside the workspace") || lowered.contains("module cache") {
            return "Names from installed packages can’t be renamed."
        }
        if lowered.contains("cannot rename this element") || lowered.contains("no identifier found") {
            return "This symbol can’t be renamed."
        }
        return server
    }
}
