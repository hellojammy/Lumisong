import Foundation
import AVFoundation
import WebKit
import UIKit
import UniformTypeIdentifiers

/// 原生音频桥（iOS 混合架构 A1）：
/// Web 端不再用 WebAudio 出声，所有播放交给原生 AVAudioPlayer（高层 API，自动处理格式/采样率/会话）。
/// - Web→原生：通过 WKScriptMessageHandler 收播放/控制指令；
/// - 原生→Web：通过 evaluateJavaScript 回传播放进度锚点，供 Web 本地外推驱动可视化。
///
/// 三条播放路径统一为"播放一个本地音频文件"：
/// - 默认音频：Bundle 内 WebContent/data/<file>
/// - 上传：UIDocumentPicker 选中文件（asCopy 到临时目录）
/// - 录音回放：Web 编码 WAV → base64 传原生落盘临时文件
final class AudioBridge: NSObject {
    /// JS 调用入口名：window.webkit.messageHandlers.audioBridge.postMessage({...})
    static let messageName = "audioBridge"

    private var player: AVAudioPlayer?
    private var currentURL: URL?

    /// 回传锚点用：持有 WebView 以 evaluateJavaScript
    weak var webView: WKWebView?

    /// 定时回传进度锚点
    private var anchorTimer: Timer?

    override init() {
        super.init()
        configureSession()
    }

    private func configureSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[AudioBridge] 音频会话配置失败: \(error)")
        }
    }

    // MARK: - 指令分发

    func handle(_ body: Any) {
        guard let dict = body as? [String: Any],
              let cmd = dict["cmd"] as? String else { return }
        switch cmd {
        case "playDefault":
            if let file = dict["file"] as? String { playBundleAudio(named: file) }
        case "pickAndPlay":
            presentDocumentPicker()
        case "recStart":
            beginRecordingTransfer(id: dict["id"] as? String ?? "")
        case "recChunk":
            appendRecordingChunk(id: dict["id"] as? String ?? "", base64: dict["data"] as? String ?? "")
        case "recEnd":
            finishRecordingTransfer(id: dict["id"] as? String ?? "")
        case "play":
            resumePlayback()
        case "pause":
            pausePlayback()
        case "seek":
            if let pos = dict["pos"] as? Double { seek(to: pos) }
        default:
            break
        }
    }

    // MARK: - 播放控制

    /// 页面导航/刷新时停止原生播放器，避免旧音频跨页面继续播放。
    func stopAll(notifyWeb: Bool = false) {
        stopAnchorTimer()
        player?.stop()
        player = nil
        currentURL = nil
        recTransferData = Data()
        recTransferId = ""
        if notifyWeb { emitState("stopped", at: 0) }
    }

    /// 载入文件并准备播放器。autoPlay=true 立即播（默认/上传）；false 仅 prepare（录音回放）。
    private func load(url: URL, autoPlay: Bool) {
        stopAnchorTimer()
        configureSession()
        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.prepareToPlay()
            player = p
            currentURL = url
            NSLog("[AudioBridge] load: \(url.lastPathComponent) dur=\(p.duration) sr=\(p.format.sampleRate) autoPlay=\(autoPlay)")
            if autoPlay {
                p.play()
                emitState("started", at: 0)
                startAnchorTimer()
            } else {
                emitState("paused", at: 0)
            }
        } catch {
            NSLog("[AudioBridge] 载入失败: \(error)")
            emitState("error", at: 0)
        }
    }

    private func playBundleAudio(named name: String) {
        guard let url = bundleAudioURL(for: name) else {
            NSLog("[AudioBridge] 默认音频未找到: \(name)")
            return
        }
        load(url: url, autoPlay: true)
    }

    private func resumePlayback() {
        guard let p = player else {
            NSLog("[AudioBridge] resumePlayback SKIP: no player")
            return
        }
        if p.isPlaying { return }
        configureSession()
        // 播完后从头重播
        if p.currentTime >= p.duration - 0.05 { p.currentTime = 0 }
        p.play()
        emitState("started", at: p.currentTime)
        startAnchorTimer()
    }

    private func pausePlayback() {
        guard let p = player, p.isPlaying else { return }
        p.pause()
        stopAnchorTimer()
        emitState("paused", at: p.currentTime)
    }

    private func seek(to pos: Double) {
        guard let p = player else { return }
        p.currentTime = max(0, min(pos, p.duration))
        emitState(p.isPlaying ? "started" : "seeked", at: p.currentTime)
    }

    // MARK: - 上传（UIDocumentPicker，路径Y）

    private func presentDocumentPicker() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: true)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            guard let presenter = self.topViewController() else {
                NSLog("[AudioBridge] 找不到 present controller")
                return
            }
            presenter.present(picker, animated: true)
        }
    }

    private func topViewController() -> UIViewController? {
        var responder: UIResponder? = webView
        while let r = responder {
            if let vc = r as? UIViewController {
                var top = vc
                while let presented = top.presentedViewController { top = presented }
                return top
            }
            responder = r.next
        }
        let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
        var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    private func handlePickedAudio(url: URL) {
        load(url: url, autoPlay: true)
        emitPickedBytes(url: url)
    }

    private func emitPickedBytes(url: URL) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, let data = try? Data(contentsOf: url) else { return }
            let b64 = data.base64EncodedString()
            let name = url.lastPathComponent
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let js = "window.__onUploadFile && window.__onUploadFile('\(name)', '\(b64)')"
            self.evalJS(js)
        }
    }

    // MARK: - 录音回放（Web 编码 WAV → base64 传原生落盘 → prepare，不自动播放）

    private var recTransferData = Data()
    private var recTransferId = ""

    private func beginRecordingTransfer(id: String) {
        recTransferId = id
        recTransferData = Data()
    }

    private func appendRecordingChunk(id: String, base64: String) {
        guard id == recTransferId else { return }
        if let chunk = Data(base64Encoded: base64) {
            recTransferData.append(chunk)
        }
    }

    private func finishRecordingTransfer(id: String) {
        guard id == recTransferId, !recTransferData.isEmpty else { return }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("recording-\(id).wav")
        do {
            try recTransferData.write(to: url)
            recTransferData = Data()
            NSLog("[AudioBridge] 录音落盘成功: \(url.lastPathComponent), \(try Data(contentsOf: url).count) bytes")
            // 只 prepare 不自动播放：录音停止后进入待播页，用户点播放才播
            load(url: url, autoPlay: false)
        } catch {
            NSLog("[AudioBridge] 录音落盘失败: \(error)")
        }
    }

    private func bundleAudioURL(for name: String) -> URL? {
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        return Bundle.main.url(forResource: base, withExtension: ext, subdirectory: "WebContent/data")
            ?? Bundle.main.url(forResource: base, withExtension: ext, subdirectory: "data")
    }

    // MARK: - 锚点回传

    private func startAnchorTimer() {
        stopAnchorTimer()
        anchorTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.emitAnchor()
        }
    }

    private func stopAnchorTimer() {
        anchorTimer?.invalidate()
        anchorTimer = nil
    }

    /// 回传播放锚点：Web 用 (anchorMs, offset, rate) 本地外推进度。
    private func emitAnchor() {
        guard let p = player else { return }
        let offset = p.currentTime
        let rate = p.isPlaying ? 1.0 : 0.0
        let js = "window.__onAudioAnchor && window.__onAudioAnchor("
            + "\(Date().timeIntervalSince1970 * 1000),\(offset),\(rate))"
        evalJS(js)
    }

    private func emitState(_ state: String, at offset: Double) {
        let js = "window.__onAudioState && window.__onAudioState('\(state)', \(offset))"
        evalJS(js)
    }

    private func evalJS(_ js: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

// MARK: - AVAudioPlayerDelegate

extension AudioBridge: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        stopAnchorTimer()
        emitState("ended", at: player.duration)
    }
}

// MARK: - WKScriptMessageHandler

extension AudioBridge: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == AudioBridge.messageName else { return }
        handle(message.body)
    }
}

// MARK: - UIDocumentPickerDelegate

extension AudioBridge: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        handlePickedAudio(url: url)
    }
}
