import SwiftUI

struct ContentView: View {
    @StateObject private var bridge = WebViewBridge()

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            WebViewContainer(bridge: bridge)
                .ignoresSafeArea()

            Button {
                bridge.reload()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().strokeBorder(.white.opacity(0.25), lineWidth: 1))
            }
            .padding(.trailing, 16)
            .padding(.bottom, 28)
        }
    }
}
