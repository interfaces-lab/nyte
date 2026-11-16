import Foundation
import NyteCore

let arguments = Array(CommandLine.arguments.dropFirst())

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let usage = """
usage: NyteProbe <command> [arguments]

  toolchain <folder> [tool ...]       print the environment and where each tool is found
  frame                               check the LSP and DAP message framer
  lsp check                           run every language client assertion against gopls and typescript-language-server
  lsp <folder> <file> <query> [line:column] [text]
                                      ask one question; queries: diagnostics hover signature complete definition typedef
                                      impl refs kinds highlights symbols workspace prepare rename actions format hints tokens log
  lsp missing <folder> <file>         print the status a server reaches when the toolchain cannot find it
  lsp bench <folder> <file> [automatic|native|tsserver]
                                      time first diagnostics, completion, workspace symbols and usages; sample memory
  dap check                           run every debug client assertion against Delve and js-debug
  dap targets <folder> [file]         list the debug targets found in a folder
  host check [folder]                 check the Nyte host client read-only against the live host, then its failure paths
  kit check                           drive every kit control with pointer, keyboard and accessibility, offscreen
  markdown check | cost               prove Markdown rendering, copy, streaming, accessibility and diagram contrast; measure cost
  terminal check                      run a real shell on a PTY with no window and check what the grid shows
  changes check | bench               prove git status, staging, the diff against git and the Changes views; time the diff
  files check                         check saved navigator state and every file operation with its undo and redo
  editor check                        prove the editor's text, lexer, file, undo and input method contracts offscreen
  editor bench [lines ...]            time a typed key, opening and scrolling at 1k to 500k lines
  search check | bench [folder] | run <folder> <text> [regex]
                                      prove Find in Files against generated corpora, grep and ripgrep; time it
  --help                              print this
"""

switch arguments.first {
case "--help", "-h", "help":
    print(usage)

case "toolchain":
    guard arguments.count >= 2 else { fail("NyteProbe toolchain needs a folder; see NyteProbe --help") }
    let toolchain = Toolchain(workspace: URL(fileURLWithPath: arguments[1]))
    let started = ContinuousClock.now
    let environment = await toolchain.environment()
    print("environment: \(environment.count) variables in \(ContinuousClock.now - started)")
    print("PATH:")
    for folder in (environment["PATH"] ?? "").split(separator: ":") { print("  \(folder)") }
    for tool in arguments.dropFirst(2) {
        print("\(tool): \(await toolchain.locate(tool)?.path ?? "not found")")
    }

case "frame":
    var framer = MessageFramer()
    let first = MessageFramer.frame(Data(#"{"a":1}"#.utf8))
    let second = MessageFramer.frame(Data(#"{"b":"héllo"}"#.utf8))
    let stream = first + second + Data("Content-Type: x\r\ncontent-length: 2\r\n\r\n{}".utf8)
    var bodies: [String] = []
    for chunk in stride(from: 0, to: stream.count, by: 5) {
        bodies += framer.append(stream[chunk..<min(chunk + 5, stream.count)]).map { String(decoding: $0, as: UTF8.self) }
    }
    let expected = [#"{"a":1}"#, #"{"b":"héllo"}"#, "{}"]
    guard bodies == expected else { fail("frame: got \(bodies), expected \(expected)") }
    print("frame: ok, \(bodies.count) bodies from \(stream.count) bytes in 5-byte chunks")

case "lsp":
    await runLanguageProbe(Array(arguments.dropFirst()))

case "dap":
    await runDebugProbe(Array(arguments.dropFirst()))

case "host":
    await runHostProbe(Array(arguments.dropFirst()))

case "editor":
    await runEditorProbe(Array(arguments.dropFirst()))

case "kit":
    runKitProbe(Array(arguments.dropFirst()))

case "markdown":
    runMarkdownProbe(Array(arguments.dropFirst()))

case "files":
    await runFilesProbe(Array(arguments.dropFirst()))

case "terminal":
    await runTerminalProbe(Array(arguments.dropFirst()))

case "changes":
    await runChangesProbe(Array(arguments.dropFirst()))

case "search":
    await runSearchProbe(Array(arguments.dropFirst()))

default:
    fail("NyteProbe: unknown command \(arguments.first ?? "(none)"); see NyteProbe --help")
}
