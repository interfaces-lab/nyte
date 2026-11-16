// swift-tools-version: 6.2
import PackageDescription

let settings: [SwiftSetting] = [
    .swiftLanguageMode(.v6),
    .treatAllWarnings(as: .error),
    .unsafeFlags(["-cross-module-optimization"], .when(configuration: .release)),
]

let features: [Target.Dependency] = [
    "NyteFiles", "NyteEditor", "NyteTerminal", "NyteAgent", "NyteLanguage", "NyteDebug", "NyteChanges", "NyteSearch",
]

let package = Package(
    name: "NyteIDE",
    platforms: [.macOS("27.0")],
    products: [.executable(name: "NyteIDE", targets: ["NyteIDE"])],
    dependencies: [
        .package(url: "https://github.com/lukilabs/beautiful-mermaid-swift", exact: "1.0.4"),
    ],
    targets: [
        .target(name: "NyteCore", swiftSettings: settings),
        .target(name: "Md4c"),
        .target(name: "NyteUI", dependencies: ["Md4c"], swiftSettings: settings),
        .target(
            name: "NyteDiagrams",
            dependencies: ["NyteUI", .product(name: "BeautifulMermaid", package: "beautiful-mermaid-swift")],
            swiftSettings: settings
        ),
        .target(name: "NyteFiles", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .target(name: "NyteEditor", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .binaryTarget(
            name: "GhosttyVt",
            url: "https://release.files.ghostty.org/libghostty-vt/1.0.1/ghostty-vt-1.0.1.xcframework.zip",
            checksum: "c0f9631277f726154c8f521954d17cdc41aac4626fc0df8cf925a19ee58e829b"
        ),
        // Swift: it cannot fork, and posix_spawn cannot give a shell its controlling terminal, so the PTY spawn is C
        .target(name: "PtySpawn"),
        .target(
            name: "NyteTerminal",
            dependencies: ["NyteCore", "NyteUI", "GhosttyVt", "PtySpawn"],
            swiftSettings: settings
        ),
        .target(name: "NyteAgent", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .target(name: "NyteLanguage", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .target(name: "NyteDebug", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .target(name: "NyteChanges", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .target(name: "NyteSearch", dependencies: ["NyteCore", "NyteUI"], swiftSettings: settings),
        .target(name: "NyteShell", dependencies: features + ["NyteCore", "NyteUI", "NyteDiagrams"], swiftSettings: settings),
        .executableTarget(name: "NyteIDE", dependencies: ["NyteShell"], swiftSettings: settings),
        .target(name: "NyteReplay", dependencies: ["NyteCore"], swiftSettings: settings),
        .executableTarget(
            name: "NyteShot", dependencies: ["NyteShell", "NyteCore", "NyteUI", "NyteReplay", "NyteAgent", "NyteChanges", "NyteSearch", "NyteTerminal"],
            swiftSettings: settings
        ),
        .executableTarget(
            name: "NyteGallery", dependencies: features + ["NyteCore", "NyteUI", "NyteDiagrams", "NyteReplay"], swiftSettings: settings
        ),
        .executableTarget(
            name: "NyteProbe", dependencies: features + ["NyteCore", "NyteUI", "NyteDiagrams", "NyteReplay"], swiftSettings: settings
        ),
    ]
)
