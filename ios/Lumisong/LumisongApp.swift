import SwiftUI
import AVFoundation

@main
struct LumisongApp: App {
    @Environment(\.scenePhase) private var scenePhase

    init() {
        configureAudioSession()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .statusBarHidden(true)
        }
        .onChange(of: scenePhase) { phase in
            // 回到前台时重新激活会话，覆盖 WKWebView 音频单元初始化时机。
            if phase == .active {
                configureAudioSession()
            }
        }
    }

    /// 让 WebAudio 输出无视静音键并走扬声器。
    /// 默认用 .playback（纯播放最可靠，强制扬声器、无视静音键）；
    /// 实时录音由 WebView 侧 getUserMedia 触发，系统会在需要时自动协商录音路由。
    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            print("[AudioSession] 配置失败: \(error)")
        }
    }
}
