import AppKit
import NyteCore
import NyteLanguage
import NyteUI

@MainActor
private enum StatusSamples {
    static let home = FileManager.default.homeDirectoryForCurrentUser
    static let repository = home.appendingPathComponent("Developer/nyte")
    static let managed = Toolchain.managedRoot
    static let native = repository.appendingPathComponent(
        "node_modules/.pnpm/typescript@7.1.0-beta/node_modules/@typescript/typescript-darwin-arm64/lib/tsc")
    static let read = EnvironmentReading(values: [:], elapsed: .milliseconds(98))
    static let slow = EnvironmentReading(values: [:], elapsed: .seconds(8), problem: "Your login shell (zsh) took longer than 8 seconds "
        + "to start, so language servers use Nyte IDE's own environment. Look for a slow step in its startup files, then choose "
        + "Reload Environment.")
    static let goplsInstall = ToolInstall(title: "Install gopls", command: [], directory: repository,
                                          shown: "go install golang.org/x/tools/gopls@latest")
    static let typeScriptInstall = ToolInstall(title: "Install TypeScript 7 in This Project", command: [], directory: repository,
                                               shown: "npm install --save-dev typescript@7")

    static func typeScript(_ state: ServerStatus.State = .ready, version: String = "TypeScript 7.1.0-beta, native",
                           source: ToolSource? = .project, location: URL? = native, note: String? = nil, install: ToolInstall? = nil,
                           offer: ServerStatus.Offer? = .useTSServer, root: String = "packages/core") -> ServerStatus {
        var status = ServerStatus(name: "TypeScript", state: state, version: version, location: location,
                                  root: repository.appendingPathComponent(root), residentBytes: state == .ready ? 326 << 20 : nil,
                                  memoryCeiling: 3_072 << 20)
        status.source = source
        status.note = note
        status.install = install
        status.offer = offer
        return status
    }

    static func gopls(_ state: ServerStatus.State = .ready, source: ToolSource? = .bundled, install: ToolInstall? = goplsInstall)
        -> ServerStatus {
        var status = ServerStatus(name: "gopls", state: state, version: state == .ready ? "v0.21.0" : "",
                                  location: source.map { $0 == .goBin ? home.appendingPathComponent("go/bin/gopls") : managed.appendingPathComponent("go/bin/gopls") },
                                  root: repository.appendingPathComponent("packages/ide/Fixtures/notifyhub-go"),
                                  residentBytes: state == .ready ? 118 << 20 : nil, memoryCeiling: 3_072 << 20)
        status.source = source
        status.install = install
        return status
    }
}

@MainActor
private func statusCard(_ statuses: [ServerStatus], environment: EnvironmentReading = StatusSamples.read) -> NSView {
    let surface = FloatingSurface(radius: Radius.card)
    surface.translatesAutoresizingMaskIntoConstraints = false
    let view = ServerStatusView()
    view.show(statuses, environment: environment)
    surface.addSubview(view)
    Pin.fill(view, in: surface)
    surface.layoutSubtreeIfNeeded()
    return surface
}

@MainActor
let languageStatusPage = GalleryPage(
    name: "language-status", settle: 0.3,
    build: {
        Gallery.page([
            Gallery.section("Server status", note: "The panel behind the editor's server mark. Each server says where it was found.", [
                Gallery.specimen("this repository: TypeScript 7.1.0-beta from the project; gopls from Nyte IDE's copy, with the user's go to install their own",
                                 statusCard([StatusSamples.typeScript(), StatusSamples.gopls()])),
                Gallery.specimen("a project that pins TypeScript 6 only: the native server checks it anyway and says so",
                                 statusCard([StatusSamples.typeScript(source: .bundled,
                                                                      location: StatusSamples.managed.appendingPathComponent(
                                                                          "node/node_modules/@typescript/typescript-darwin-arm64/lib/tsc"),
                                                                      note: "project uses 6.0.3", install: StatusSamples.typeScriptInstall)])),
                Gallery.specimen("Use tsserver for This Workspace chosen: typescript-language-server, with the way back",
                                 statusCard([StatusSamples.typeScript(
                                     version: "typescript-language-server 6.1.0, TypeScript 6.0.3", source: .bundled,
                                     location: StatusSamples.managed.appendingPathComponent("node/node_modules/.bin/typescript-language-server"),
                                     offer: .useNative)])),
                Gallery.specimen("nothing installed anywhere: each offers the user's own toolchain",
                                 statusCard([
                                     StatusSamples.typeScript(.missing(hint: ""), version: "", source: nil, location: nil,
                                                              install: StatusSamples.typeScriptInstall, offer: nil),
                                     StatusSamples.gopls(.missing(hint: ""), source: nil),
                                 ])),
                Gallery.specimen("gopls the user installed with go install, found in Go's bin folder",
                                 statusCard([StatusSamples.gopls(source: .goBin, install: nil)])),
                Gallery.specimen("the login shell hit the 8 s limit", statusCard([StatusSamples.gopls()], environment: StatusSamples.slow)),
            ]),
        ])
    }
)
