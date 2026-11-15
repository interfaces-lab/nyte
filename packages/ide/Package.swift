// swift-tools-version: 6.2
import PackageDescription

let settings: [SwiftSetting] = [
    .swiftLanguageMode(.v6),
    .unsafeFlags(["-cross-module-optimization"], .when(configuration: .release)),
]

let package = Package(
    name: "NyteIDE",
    platforms: [.macOS("27.0")],
    targets: [
        .target(name: "NyteCore", swiftSettings: settings),
        .target(name: "NyteDesign", swiftSettings: settings),
        .target(name: "NyteFiles", dependencies: ["NyteCore", "NyteDesign"], swiftSettings: settings),
        .target(name: "NyteEditor", dependencies: ["NyteCore", "NyteDesign"], swiftSettings: settings),
        .target(name: "NyteTerminal", dependencies: ["NyteCore", "NyteDesign"], swiftSettings: settings),
        .target(name: "NyteAgent", dependencies: ["NyteCore", "NyteDesign"], swiftSettings: settings),
        .executableTarget(
            name: "NyteIDE",
            dependencies: ["NyteCore", "NyteDesign", "NyteFiles", "NyteEditor", "NyteTerminal", "NyteAgent"],
            swiftSettings: settings
        ),
    ]
)
