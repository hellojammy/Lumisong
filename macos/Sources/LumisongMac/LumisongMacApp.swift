import SwiftUI

@main
struct LumisongMacApp: App {
    var body: some Scene {
        WindowGroup {
            WebViewContainer()
                .frame(minWidth: 1024, minHeight: 700)
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
