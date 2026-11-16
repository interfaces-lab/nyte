import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    static let findSource = "let alpha = Alpha(1)\nlet beta = alpha + alphabet\n// alpha again\nalpha.go()\n"
    static let largeFindLines = 100_000

    func findQueries() {
        let buffer = TextBuffer(Self.findSource)
        let cases: [(String, FindQuery, Int)] = [
            ("a literal ignores case by default", FindQuery(pattern: "alpha"), 6),
            ("Match Case narrows it", FindQuery(pattern: "alpha", matchesCase: true), 5),
            ("Words skips alphabet", FindQuery(pattern: "alpha", wholeWords: true), 5),
            ("a regular expression", FindQuery(pattern: "al[a-z]+a", isRegex: true), 6),
            ("literal text escapes regex syntax", FindQuery(pattern: "(1)"), 1),
        ]
        for (name, query, count) in cases {
            let found = FindQuery.search(query, in: buffer, within: nil)
            let ranges = if case .success(let found)? = found { found.ranges.count } else { -1 }
            expect(ranges == count, "find: \(name)", "\(ranges)")
        }
        let invalid = FindQuery.search(FindQuery(pattern: "(", isRegex: true), in: buffer, within: nil)
        expect(invalid == .failure(.invalidPattern("This isn’t a valid regular expression.")), "find: an invalid regular expression is a problem to show, not an empty result")
        let replaced = FindQuery.search(FindQuery(pattern: "(a)(l)pha", isRegex: true), in: buffer, within: nil, replacingWith: "$2$1")
        expect((try? replaced?.get().replacements?.first) == "la", "find: replacement templates use the captures")
    }

    func findBar() async {
        findQueries()
        let editor = await openEditor(Self.findSource, file: "find.go")
        guard let finding = editor.finding else { return expect(false, "the find feature is installed") }
        let show = NSMenuItem(title: "Find", action: #selector(NSResponder.performTextFinderAction(_:)), keyEquivalent: "f")
        show.tag = NSTextFinder.Action.showFindInterface.rawValue
        expect(editor.textView.validateUserInterfaceItem(show), "Find is enabled through performTextFinderAction")
        editor.textView.performTextFinderAction(show)
        editor.findBar.field.stringValue = "alpha"
        editor.findBar.field.onChange?("alpha")
        await settle { finding.matches.count == 6 }
        expect(!editor.findBar.isHidden && finding.matches.count == 6 && editor.findBar.field.count.hasSuffix("of 6"),
               "the find bar searches as you type and shows the count and the current match", editor.findBar.field.count)
        let next = NSMenuItem(title: "Find Next", action: #selector(NSResponder.performTextFinderAction(_:)), keyEquivalent: "g")
        next.tag = NSTextFinder.Action.nextMatch.rawValue
        let before = editor.textView.selectedRange()
        editor.textView.performTextFinderAction(next)
        expect(editor.textView.selectedRange() != before && finding.matches.contains(editor.textView.selectedRange()), "Find Next selects the next match")
        finding.toggle(.wholeWords)
        await settle { finding.matches.count == 5 }
        finding.selectAllMatches()
        expect(editor.textView.selections.count == 5, "Select All Matches makes one selection per match")
        editor.textView.setSelectedRange(NSRange(location: 0, length: 0))
        editor.findBar.replace.stringValue = "omega"
        finding.replaceAll()
        await settle { !editor.shownText.string.contains("alpha ") }
        let replaced = editor.shownText.string
        editor.shown?.undo.undo()
        expect(replaced.components(separatedBy: "omega").count == 6 && replaced.contains("alphabet") && editor.shownText.string == Self.findSource,
               "Replace All replaces every whole word in one undo step", replaced.debugDescription)
        finding.toggle(.wholeWords)
        finding.toggle(.regex)
        editor.findBar.field.stringValue = "al(pha"
        editor.findBar.field.onChange?("al(pha")
        await settle { editor.findBar.field.isInvalid }
        expect(!editor.findBar.field.message.isEmpty && finding.matches.isEmpty, "an invalid regular expression is shown under the field")
        finding.toggle(.regex)
        editor.textView.setSelectedRange(NSRange(location: 21, length: 27))
        editor.findBar.field.stringValue = "alpha"
        finding.toggle(.inSelection)
        await settle { finding.matches.count == 2 }
        expect(finding.matches.allSatisfy { NSLocationInRange($0.location, NSRange(location: 21, length: 27)) }, "Find in Selection searches only the selection")
        finding.close()
        expect(editor.findBar.isHidden && editor.view.window?.firstResponder === editor.textView, "closing the bar returns focus to the text")
        await findLarge()
    }

    func findLarge() async {
        let editor = await openEditor(EditorBench.goSource(lines: Self.largeFindLines), file: "findlarge.go")
        guard let finding = editor.finding else { return }
        finding.open(replacing: false)
        let started = ContinuousClock.now
        for pattern in ["S", "Sp", "Spr", "Sprintf"] {
            editor.findBar.field.stringValue = pattern
            editor.findBar.field.onChange?(pattern)
        }
        let typed = ContinuousClock.now - started
        await settle { finding.query.pattern == "Sprintf" && finding.matches.count > 0 }
        let units = Self.largeFindLines / EditorBench.unitLines
        expect(typed < .milliseconds(16) && finding.matches.count == units,
               "find in a \(Self.largeFindLines)-line file runs off the main actor, each keystroke cancelling the search before it",
               "typing \(typed), \(finding.matches.count) matches against \(units)")
        finding.close()
    }
}
