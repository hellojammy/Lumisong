import Foundation
import WebKit

/// 将 app://app/<path> 映射到 Bundle 内 WebContent/<path>。
/// 提供安全上下文以满足 getUserMedia，并正确解析 dist 的绝对路径。
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "com.lumisong.scheme", qos: .userInitiated)
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask)
        let url = urlSchemeTask.request.url

        queue.async { [weak self] in
            guard let self else { return }

            guard let fileURL = self.resolveFileURL(for: url),
                  let data = try? Data(contentsOf: fileURL) else {
                self.respond404(urlSchemeTask, id: id)
                return
            }

            let mime = self.mimeType(for: fileURL.pathExtension)
            let response = HTTPURLResponse(
                url: url ?? appEntryURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": mime,
                    "Content-Length": "\(data.count)",
                    "Access-Control-Allow-Origin": "*",
                ]
            )!

            self.finish(urlSchemeTask, id: id, response: response, data: data)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        lock.lock()
        stopped.insert(ObjectIdentifier(urlSchemeTask))
        lock.unlock()
    }

    // MARK: - Path resolution

    private func resolveFileURL(for url: URL?) -> URL? {
        guard let url else { return nil }
        // app://app/<path>；path 为空或 "/" 时回退 index.html
        var path = url.path
        if path.isEmpty || path == "/" {
            path = "/index.html"
        }
        let relative = String(path.drop(while: { $0 == "/" }))
        guard let base = Bundle.main.resourceURL?.appendingPathComponent("WebContent") else {
            return nil
        }
        let candidate = base.appendingPathComponent(relative).standardizedFileURL
        // 防目录穿越：必须仍在 WebContent 内
        guard candidate.path.hasPrefix(base.standardizedFileURL.path) else { return nil }
        return candidate
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "wav": return "audio/wav"
        case "png": return "image/png"
        default: return "application/octet-stream"
        }
    }

    // MARK: - Task lifecycle (guard against stopped tasks)

    private func isStopped(_ id: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped.contains(id)
    }

    private func clear(_ id: ObjectIdentifier) {
        lock.lock(); stopped.remove(id); lock.unlock()
    }

    private func finish(_ task: WKURLSchemeTask, id: ObjectIdentifier, response: URLResponse, data: Data) {
        DispatchQueue.main.async {
            guard !self.isStopped(id) else { self.clear(id); return }
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
            self.clear(id)
        }
    }

    private func respond404(_ task: WKURLSchemeTask, id: ObjectIdentifier) {
        DispatchQueue.main.async {
            guard !self.isStopped(id) else { self.clear(id); return }
            let response = HTTPURLResponse(
                url: task.request.url ?? appEntryURL,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: nil
            )!
            task.didReceive(response)
            task.didFinish()
            self.clear(id)
        }
    }
}
