import SwiftUI
import WebKit

/// 自定义 scheme，避免 file:// 的绝对路径与非安全上下文问题。
let appScheme = "app"
/// 入口 URL：app://app/index.html
let appEntryURL = URL(string: "\(appScheme)://app/index.html")!

/// WebAudio 解锁脚本：解决 WKWebView 中 AudioContext 不出声（已确认 HTML audio 有声、纯 WebAudio 无声）。
/// 1. hook AudioContext 构造器，收集页面创建的所有实例；
/// 2. 首次用户手势时 resume 全部实例，并启动一个静音循环的 HTML <audio>
///    持续撑开 WKWebView 音频管线，使 WebAudio 输出得以激活。
let audioUnlockScript = """
(function () {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  var ctxs = [];
  var OrigAC = AC;
  function Patched() {
    var ctx = OrigAC.apply(this, arguments) || this;
    var inst = (this instanceof OrigAC) ? this : ctx;
    ctxs.push(inst);
    return inst;
  }
  // 用代理保留原型链与静态属性
  try {
    window.AudioContext = new Proxy(OrigAC, {
      construct: function (target, args) {
        var inst = new target(...args);
        ctxs.push(inst);
        return inst;
      }
    });
    if (window.webkitAudioContext) {
      window.webkitAudioContext = window.AudioContext;
    }
  } catch (e) {
    // Proxy 不可用时退回函数包装
    Patched.prototype = OrigAC.prototype;
    window.AudioContext = Patched;
  }

  var keepAlive = null;

  var unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;

    // 关键：让一个 HTML <audio> 在手势内持续循环播放，激活并维持 WKWebView 音频管线。
    // 纯 WebAudio 静音 buffer 撑不开管线，必须用 media 元素；且本设备需持续播放维持通道
    // （pause 后通道即关、WebAudio 再次静音），故 loop 常驻。
    // 源用全 0 采样的静音 wav（silence.wav），既维持通道又完全无声。
    try {
      keepAlive = new Audio('app://app/data/silence.wav');
      keepAlive.loop = true;
      keepAlive.volume = 1.0;
      keepAlive.muted = false;
      keepAlive.play().catch(function () {});
    } catch (e) {}

    ctxs.forEach(function (ctx) {
      try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
    });
  }

  ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { capture: true, passive: true });
  });
})();
"""

/// 持有 WKWebView 引用，供原生 UI（如刷新按钮）触发操作。
final class WebViewBridge: ObservableObject {
    weak var webView: WKWebView?

    func reload() {
        // 重新从入口加载，确保资源与状态完全重置。
        webView?.load(URLRequest(url: appEntryURL))
    }
}

struct WebViewContainer: UIViewRepresentable {
    @ObservedObject var bridge: WebViewBridge

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: appScheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // 注入 WebAudio 解锁脚本：WKWebView 中 AudioContext 默认不出声，
        // 需在首次用户手势内 resume 并播放一个静音 buffer 来激活音频管线。
        let unlock = WKUserScript(
            source: audioUnlockScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(unlock)

        // 原生音频桥（A1）：注册 Web→原生消息通道，承担所有播放出声。
        config.userContentController.add(context.coordinator.audioBridge, name: AudioBridge.messageName)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        // 允许 Mac Safari「开发」菜单远程调试此 WebView（iOS 16.4+ 必须显式开启）。
        // 仅 DEBUG 构建开启，生产构建不暴露调试入口。
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        webView.load(URLRequest(url: appEntryURL))
        bridge.webView = webView
        context.coordinator.audioBridge.webView = webView
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        /// 原生音频桥，持有于 Coordinator 生命周期，避免被释放。
        let audioBridge = AudioBridge()

        /// 页面刷新/导航时必须停止原生音频；WKWebView reload 不会自动停止 AVAudioEngine。
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            audioBridge.stopAll(notifyWeb: true)
        }

        /// Web 内容进程被系统回收时也清理原生音频，避免孤儿播放。
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            audioBridge.stopAll(notifyWeb: true)
        }

        /// 网页发起 getUserMedia 时，授予麦克风权限（系统层授权框由 WebKit 触发）。
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }
    }
}
