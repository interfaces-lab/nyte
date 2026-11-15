// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "NyteStudio",
  platforms: [.macOS(.v26)],
  products: [
    .library(name: "NyteKit", targets: ["NyteKit"]),
    .library(name: "NyteDesign", targets: ["NyteDesign"]),
    .library(name: "Lune", targets: ["Lune"]),
    .executable(name: "NyteStudio", targets: ["NyteStudio"]),
    .executable(name: "lune", targets: ["LuneCLI"]),
  ],
  dependencies: [
    // Flexbox layout: the engine React Native lays out with.
    .package(url: "https://github.com/react/yoga", from: "3.2.2")
  ],
  targets: [
    .target(name: "Lune", dependencies: [.product(name: "yoga", package: "yoga")]),
    .target(name: "NyteKit"),
    .target(name: "NyteDesign", dependencies: ["Lune"]),
    .executableTarget(name: "NyteStudio", dependencies: ["Lune", "NyteKit", "NyteDesign"]),
    .executableTarget(name: "LuneCLI", dependencies: ["Lune", "NyteDesign"]),
  ],
  swiftLanguageModes: [.v5]
)
