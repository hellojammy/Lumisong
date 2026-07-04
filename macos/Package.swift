// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LumisongMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "LumisongMac", targets: ["LumisongMac"])
    ],
    targets: [
        .executableTarget(
            name: "LumisongMac",
            path: "Sources/LumisongMac"
        )
    ]
)
